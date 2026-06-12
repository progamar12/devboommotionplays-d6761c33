import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Mk9Game } from "@/components/Mk9Game";

export const Route = createFileRoute("/host")({
  head: () => ({
    meta: [
      { title: "Host — MoCap Bridge" },
      { name: "description", content: "Receive phone camera and render a live 3D skeleton." },
    ],
  }),
  component: HostPage,
});

type Status = "booting" | "waiting" | "connected" | "tracking" | "error";

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

function HostPage() {
  const [room, setRoom] = useState<string>("");
  const [status, setStatus] = useState<Status>("booting");
  const [message, setMessage] = useState<string>("Initializing…");
  const [fps, setFps] = useState<number>(0);
  const [landmarkCount, setLandmarkCount] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Generate room only on the client to avoid SSR/hydration mismatch
  useEffect(() => {
    setRoom(generateRoomCode());
  }, []);

  const phoneUrl = useMemo(() => {
    if (typeof window === "undefined" || !room) return "";
    return `${window.location.origin}/phone?room=${room}`;
  }, [room]);

  // --- Three.js scene ---
  useEffect(() => {
    if (!stageRef.current) return;
    let disposed = false;
    let renderer: import("three").WebGLRenderer | null = null;
    let frameId = 0;
    const stage = stageRef.current;

    let updateSkeletonRef: ((landmarks: Array<{ x: number; y: number; z: number }> | null) => void) | null = null;

    (async () => {
      const THREE = await import("three");
      if (disposed) return;

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x0a0e1a, 0.05);

      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 1.6, 3.4);
      camera.lookAt(0, 1, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      stage.appendChild(renderer.domElement);

      const resize = () => {
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        renderer!.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(stage);

      // Grid floor
      const grid = new THREE.GridHelper(10, 20, 0x00e6ff, 0x004a66);
      (grid.material as import("three").Material).transparent = true;
      (grid.material as import("three").Material).opacity = 0.55;
      scene.add(grid);

      // Secondary larger grid for depth
      const farGrid = new THREE.GridHelper(40, 40, 0x003a55, 0x002233);
      (farGrid.material as import("three").Material).transparent = true;
      (farGrid.material as import("three").Material).opacity = 0.25;
      scene.add(farGrid);

      // Ambient glow
      scene.add(new THREE.AmbientLight(0x88aaff, 0.6));
      const key = new THREE.PointLight(0x00ffff, 1, 20);
      key.position.set(2, 3, 2);
      scene.add(key);

      // Skeleton — 33 joints (MediaPipe Pose)
      const JOINT_COUNT = 33;
      const jointGeo = new THREE.SphereGeometry(0.035, 12, 12);
      const jointMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
      const joints: import("three").Mesh[] = [];
      const skeletonGroup = new THREE.Group();
      for (let i = 0; i < JOINT_COUNT; i++) {
        const m = new THREE.Mesh(jointGeo, jointMat);
        m.visible = false;
        joints.push(m);
        skeletonGroup.add(m);
      }

      // MediaPipe pose connections
      const CONNECTIONS: Array<[number, number]> = [
        [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
        [11, 23], [12, 24], [23, 24],
        [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
        [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
        [15, 17], [15, 19], [15, 21], [17, 19],
        [16, 18], [16, 20], [16, 22], [18, 20],
        [9, 10], [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
      ];

      const boneMat = new THREE.LineBasicMaterial({ color: 0xff44cc, linewidth: 2 });
      const boneGeo = new THREE.BufferGeometry();
      const bonePositions = new Float32Array(CONNECTIONS.length * 2 * 3);
      boneGeo.setAttribute("position", new THREE.BufferAttribute(bonePositions, 3));
      const bones = new THREE.LineSegments(boneGeo, boneMat);
      bones.visible = false;
      skeletonGroup.add(bones);
      scene.add(skeletonGroup);

      // Placeholder idle marker
      const idle = new THREE.Mesh(
        new THREE.TorusGeometry(0.4, 0.02, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 }),
      );
      idle.rotation.x = Math.PI / 2;
      scene.add(idle);

      updateSkeletonRef = (landmarks) => {
        if (!landmarks || landmarks.length === 0) {
          joints.forEach((j) => (j.visible = false));
          bones.visible = false;
          idle.visible = true;
          return;
        }
        idle.visible = false;

        // Map normalized landmarks (x,y in [0,1], z relative depth) into world
        // x: 0 (left of image) -> 1 (right). Flip so user sees mirror.
        // y: 0 (top) -> 1 (bottom). Map to world height (head up).
        // z: ~ -0.5..0.5 forward/back.
        const W = 2.4, H = 2.6, D = 1.6;
        for (let i = 0; i < JOINT_COUNT; i++) {
          const lm = landmarks[i];
          if (!lm) { joints[i].visible = false; continue; }
          const x = -((lm.x - 0.5) * W);
          const y = (1 - lm.y) * H * 0.95;
          const z = -lm.z * D;
          joints[i].position.set(x, y, z);
          joints[i].visible = true;
        }
        for (let k = 0; k < CONNECTIONS.length; k++) {
          const [a, b] = CONNECTIONS[k];
          const pa = joints[a]?.position;
          const pb = joints[b]?.position;
          const off = k * 6;
          if (pa && pb) {
            bonePositions[off] = pa.x; bonePositions[off + 1] = pa.y; bonePositions[off + 2] = pa.z;
            bonePositions[off + 3] = pb.x; bonePositions[off + 4] = pb.y; bonePositions[off + 5] = pb.z;
          }
        }
        boneGeo.attributes.position.needsUpdate = true;
        bones.visible = true;
      };

      const clock = new THREE.Clock();
      const animate = () => {
        const t = clock.getElapsedTime();
        idle.rotation.z = t * 0.6;
        renderer!.render(scene, camera);
        frameId = requestAnimationFrame(animate);
      };
      animate();

      // expose for cleanup
      (stage as unknown as { __cleanup?: () => void }).__cleanup = () => {
        cancelAnimationFrame(frameId);
        ro.disconnect();
        renderer?.dispose();
        if (renderer?.domElement.parentNode === stage) stage.removeChild(renderer.domElement);
      };
    })();

    // Bridge: set on window so the other effect (pose) can call it
    type LM = Array<{ x: number; y: number; z: number }> | null;
    (window as unknown as { __mocapUpdate?: (lm: LM) => void }).__mocapUpdate = (lm: LM) =>
      updateSkeletonRef?.(lm);

    return () => {
      disposed = true;
      (stage as unknown as { __cleanup?: () => void }).__cleanup?.();
      delete (window as unknown as { __mocapUpdate?: unknown }).__mocapUpdate;
    };
  }, []);

  // --- PeerJS + MediaPipe ---
  useEffect(() => {
    if (!room) return;
    let disposed = false;
    let peer: import("peerjs").Peer | null = null;
    let landmarker: import("@mediapipe/tasks-vision").PoseLandmarker | null = null;
    let rafId = 0;
    let lastVideoTime = -1;
    let frameCount = 0;
    let fpsTimer = performance.now();

    (async () => {
      try {
        setStatus("waiting");
        setMessage("Loading pose model…");

        const vision = await import("@mediapipe/tasks-vision");
        if (disposed) return;
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
        );
        landmarker = await vision.PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });

        if (disposed) return;
        setMessage(`Waiting for phone… room ${room}`);

        const { Peer } = await import("peerjs");
        peer = new Peer(room, { debug: 1 });

        peer.on("open", () => {
          setStatus("waiting");
          setMessage(`Ready. Room ${room}. Scan QR with phone.`);
        });
        peer.on("error", (e) => {
          setStatus("error");
          setMessage(`Peer error: ${e.type ?? e.message ?? "unknown"}`);
        });
        peer.on("call", (call) => {
          call.answer();
          call.on("stream", async (remoteStream) => {
            const v = videoRef.current!;
            v.srcObject = remoteStream;
            await v.play().catch(() => {});
            setStatus("connected");
            setMessage("Phone connected. Detecting pose…");
            startPoseLoop();
          });
          call.on("close", () => {
            setStatus("waiting");
            setMessage("Phone disconnected.");
            const update = (window as unknown as { __mocapUpdate?: (l: null) => void }).__mocapUpdate;
            update?.(null);
          });
        });

        const startPoseLoop = () => {
          const v = videoRef.current!;
          const c = canvasRef.current!;
          const ctx = c.getContext("2d")!;

          const loop = () => {
            if (disposed) return;
            if (v.readyState >= 2 && v.videoWidth > 0) {
              if (c.width !== v.videoWidth) {
                c.width = v.videoWidth;
                c.height = v.videoHeight;
              }
              // Draw preview (mirrored)
              ctx.save();
              ctx.translate(c.width, 0);
              ctx.scale(-1, 1);
              ctx.drawImage(v, 0, 0, c.width, c.height);
              ctx.restore();

              const now = performance.now();
              if (v.currentTime !== lastVideoTime && landmarker) {
                lastVideoTime = v.currentTime;
                const result = landmarker.detectForVideo(v, now);
                const lm = result.landmarks?.[0] ?? null;
                setLandmarkCount(lm?.length ?? 0);
                if (lm) {
                  // Draw 2D dots overlay on canvas (mirrored)
                  ctx.fillStyle = "rgba(0,255,255,0.9)";
                  for (const p of lm) {
                    const x = c.width - p.x * c.width; // mirror
                    const y = p.y * c.height;
                    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
                  }
                }
                const update = (window as unknown as {
                  __mocapUpdate?: (l: Array<{ x: number; y: number; z: number }> | null) => void;
                }).__mocapUpdate;
                update?.(lm);
                setStatus(lm ? "tracking" : "connected");
              }

              frameCount++;
              if (now - fpsTimer >= 1000) {
                setFps(Math.round((frameCount * 1000) / (now - fpsTimer)));
                frameCount = 0;
                fpsTimer = now;
              }
            }
            rafId = requestAnimationFrame(loop);
          };
          loop();
        };
      } catch (e) {
        const err = e as Error;
        setStatus("error");
        setMessage(err.message || "Failed to initialize.");
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      peer?.destroy();
      landmarker?.close();
    };
  }, [room]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-block size-2.5 rounded-full bg-primary glow-cyan animate-pulse" />
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">mocap host</div>
        </div>
        <div className="flex items-center gap-6 font-mono text-xs text-muted-foreground">
          <span>STATUS <span className="text-foreground">{status}</span></span>
          <span>FPS <span className="text-foreground">{fps}</span></span>
          <span>JOINTS <span className="text-foreground">{landmarkCount}</span></span>
        </div>
      </header>

      <div className="flex-1 grid lg:grid-cols-[1fr_360px] gap-0">
        {/* 3D stage */}
        <div className="relative bg-black/40 grid-bg overflow-hidden">
          <div ref={stageRef} className="absolute inset-0" />
          <div className="absolute bottom-4 left-4 right-4 font-mono text-xs text-muted-foreground">
            {message}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="border-l border-border bg-card/60 backdrop-blur p-6 space-y-6 overflow-y-auto">
          <section>
            <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Pair phone</h2>
            <div className="mt-3 rounded-xl bg-background border border-border p-4 flex flex-col items-center">
              {phoneUrl ? (
                <QRCodeSVG
                  value={phoneUrl}
                  size={208}
                  bgColor="transparent"
                  fgColor="#00e6ff"
                  level="M"
                />
              ) : (
                <div className="size-52 grid place-items-center text-muted-foreground text-xs">…</div>
              )}
              <div className="mt-4 font-mono text-2xl tracking-[0.4em] text-primary glow-text">
                {room || "······"}
              </div>
              <div className="mt-2 text-[10px] font-mono text-muted-foreground break-all text-center">
                {phoneUrl}
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Camera feed</h2>
            <div className="mt-3 rounded-xl overflow-hidden border border-border aspect-video bg-black">
              <canvas ref={canvasRef} className="w-full h-full object-cover" />
              <video ref={videoRef} className="hidden" playsInline muted />
            </div>
          </section>

          <section className="text-xs text-muted-foreground font-mono leading-relaxed">
            <h2 className="text-primary uppercase tracking-widest mb-2">Cast to TV</h2>
            <p>Chrome → ⋮ → Cast → choose your TV → Cast tab. Or use AirPlay / HDMI mirroring.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
