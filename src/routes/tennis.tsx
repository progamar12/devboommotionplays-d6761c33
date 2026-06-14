import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/tennis")({
  head: () => ({
    meta: [
      { title: "VR Tennis — MoCap Bridge" },
      { name: "description", content: "First-person VR tennis. Jump to swing your racket." },
    ],
  }),
  component: TennisPage,
});

type LM = { x: number; y: number; z: number };

function TennisPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState({ you: 0, cpu: 0 });
  const [streak, setStreak] = useState(0);
  const [message, setMessage] = useState("Press SPACE or JUMP to swing");
  const stateRef = useRef({
    score: { you: 0, cpu: 0 },
    streak: 0,
    setScore: setScore as (s: { you: number; cpu: number }) => void,
    setStreak: setStreak as (n: number) => void,
    setMessage: setMessage as (m: string) => void,
  });
  stateRef.current.setScore = setScore;
  stateRef.current.setStreak = setStreak;
  stateRef.current.setMessage = setMessage;

  useEffect(() => {
    if (!stageRef.current) return;
    const stage = stageRef.current;
    let disposed = false;
    let frameId = 0;
    let renderer: import("three").WebGLRenderer | null = null;
    const swingRef = { active: false, t: 0 };

    (async () => {
      const THREE = await import("three");
      if (disposed) return;

      const scene = new THREE.Scene();
      // Sunset sky gradient via fog + clear color
      scene.background = new THREE.Color(0xffb066);
      scene.fog = new THREE.Fog(0xffc080, 30, 90);

      // First-person camera at player height
      const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
      camera.position.set(0, 1.65, 11);
      camera.lookAt(0, 1.2, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      stage.appendChild(renderer.domElement);

      const resize = () => {
        const w = stage.clientWidth, h = stage.clientHeight;
        renderer!.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(stage);

      // Sky dome (gradient)
      const skyGeo = new THREE.SphereGeometry(80, 32, 16);
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          top: { value: new THREE.Color(0xff8a5b) },
          mid: { value: new THREE.Color(0xffc070) },
          bot: { value: new THREE.Color(0xffe6a8) },
        },
        vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
        fragmentShader: `varying vec3 vPos; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
          void main(){ float h = normalize(vPos).y; vec3 c = mix(bot, mid, smoothstep(-0.1, 0.4, h)); c = mix(c, top, smoothstep(0.4, 0.9, h)); gl_FragColor = vec4(c, 1.0);} `,
      });
      scene.add(new THREE.Mesh(skyGeo, skyMat));

      // Sun
      const sun = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshBasicMaterial({ color: 0xfff1c0 }));
      sun.position.set(0, 14, -40);
      scene.add(sun);

      // Distant clouds (simple white rounded rectangles)
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(
          new THREE.SphereGeometry(2 + Math.random() * 1.5, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xfff4dc }),
        );
        c.position.set(-25 + i * 9 + Math.random() * 3, 7 + Math.random() * 2, -38);
        c.scale.set(1.6, 0.6, 0.6);
        scene.add(c);
      }

      // Back fence (chain link suggestion)
      const fence = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 2.2),
        new THREE.MeshBasicMaterial({ color: 0xeaeaea, transparent: true, opacity: 0.65 }),
      );
      fence.position.set(0, 1.1, -22);
      scene.add(fence);

      // Court — orange clay
      const court = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 24),
        new THREE.MeshBasicMaterial({ color: 0xe87a3e }),
      );
      court.rotation.x = -Math.PI / 2;
      court.position.set(0, 0, 0);
      scene.add(court);

      // Outer apron
      const apron = new THREE.Mesh(
        new THREE.PlaneGeometry(22, 34),
        new THREE.MeshBasicMaterial({ color: 0xc8693a }),
      );
      apron.rotation.x = -Math.PI / 2;
      apron.position.set(0, -0.01, -1);
      scene.add(apron);

      // White court lines
      const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const addLine = (w: number, l: number, x: number, z: number) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
        m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, z); scene.add(m);
      };
      addLine(11, 0.08, 0, -12);  // baseline far
      addLine(11, 0.08, 0, 12);   // baseline near
      addLine(0.08, 24, -5.5, 0); // sideline L
      addLine(0.08, 24, 5.5, 0);  // sideline R
      addLine(11, 0.06, 0, 0);    // net line
      addLine(0.06, 13, 0, 5.5);  // center service
      addLine(8, 0.06, 0, -6);    // service line far
      addLine(8, 0.06, 0, 6);     // service line near
      addLine(0.06, 12, -4, 0);   // singles L inner
      addLine(0.06, 12, 4, 0);    // singles R inner

      // Net
      const net = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 1),
        new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      net.position.set(0, 0.5, 0);
      scene.add(net);
      const netTop = new THREE.Mesh(new THREE.PlaneGeometry(12, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      netTop.position.set(0, 1, 0);
      scene.add(netTop);

      // CPU opponent (silhouette)
      const cpu = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.35, 1.0, 4, 8),
        new THREE.MeshBasicMaterial({ color: 0x222233 }),
      );
      cpu.position.set(0, 0.85, -10.5);
      scene.add(cpu);

      // Ball
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xdfff5a }),
      );
      ball.position.set(0, 1.2, -10);
      scene.add(ball);

      // Ball shadow
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.16, 16),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
      );
      shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow);

      // Racket (in front of camera)
      const racketGroup = new THREE.Group();
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8),
        new THREE.MeshBasicMaterial({ color: 0x331a0a }),
      );
      handle.position.y = -0.2;
      racketGroup.add(handle);
      const head = new THREE.Mesh(
        new THREE.TorusGeometry(0.18, 0.018, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xff2266 }),
      );
      head.position.y = 0.05;
      racketGroup.add(head);
      const strings = new THREE.Mesh(
        new THREE.CircleGeometry(0.17, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
      );
      strings.position.y = 0.05;
      racketGroup.add(strings);
      // anchor in front of camera
      racketGroup.position.set(0.45, 1.25, 10.2);
      racketGroup.rotation.set(-0.3, -0.2, -0.3);
      scene.add(racketGroup);

      // Ball physics
      const bv = new THREE.Vector3(0, 0, 0); // velocity
      let ballState: "serving" | "incoming" | "outgoing" | "dead" = "serving";
      let serveTimer = 0;
      const GRAV = -9.8;

      const targetXBounce = () => (Math.random() - 0.5) * 9; // anywhere across player half
      const targetZBounce = () => 4 + Math.random() * 7;    // near half between net & baseline

      const startServe = () => {
        ball.position.set(0, 1.4, -10.5);
        const tx = targetXBounce();
        const tz = targetZBounce();
        // simple projectile: solve so ball lands at (tx, 0, tz) after T sec
        const T = 0.9 + Math.random() * 0.4;
        bv.set((tx - ball.position.x) / T, (0 - ball.position.y - 0.5 * GRAV * T * T) / T, (tz - ball.position.z) / T);
        ballState = "incoming";
        stateRef.current.setMessage("Incoming! Jump to swing.");
      };

      serveTimer = 1.2;

      // Trigger swing
      const trySwing = () => {
        if (swingRef.active) return;
        swingRef.active = true;
        swingRef.t = 0;
        if (ballState === "incoming") {
          // Check ball within swing zone (close to camera)
          const dx = ball.position.x - 0.0;
          const dy = ball.position.y - 1.4;
          const dz = ball.position.z - 10.0;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < 1.6) {
            // HIT — send back to opponent area
            const tx = (Math.random() - 0.5) * 8;
            const tz = -6 - Math.random() * 5;
            const T = 0.8 + Math.random() * 0.3;
            bv.set((tx - ball.position.x) / T, (0.6 - ball.position.y - 0.5 * GRAV * T * T) / T, (tz - ball.position.z) / T);
            ballState = "outgoing";
            stateRef.current.streak += 1;
            stateRef.current.setStreak(stateRef.current.streak);
            stateRef.current.setMessage(`Nice hit! Streak ${stateRef.current.streak}`);
          } else {
            stateRef.current.setMessage("Swing too early/late");
          }
        }
      };

      // Keyboard
      const onKey = (e: KeyboardEvent) => {
        if (e.code === "Space") { e.preventDefault(); trySwing(); }
      };
      window.addEventListener("keydown", onKey);

      // Pose listener — jump = swing
      let baselineHipY: number | null = null;
      let lastJumpAt = 0;
      const w = window as unknown as { __mk9Update?: (lm: LM[] | null) => void };
      const prev = w.__mk9Update;
      w.__mk9Update = (lm: LM[] | null) => {
        prev?.(lm);
        if (!lm) return;
        const hip = lm[23] && lm[24] ? { y: (lm[23].y + lm[24].y) / 2 } : null;
        if (!hip) return;
        if (baselineHipY == null) baselineHipY = hip.y;
        baselineHipY = baselineHipY * 0.97 + hip.y * 0.03;
        const lift = baselineHipY - hip.y; // smaller y = higher in image
        const now = performance.now();
        if (lift > 0.06 && now - lastJumpAt > 600) {
          lastJumpAt = now;
          trySwing();
        }
      };

      // Animate
      const clock = new THREE.Clock();
      const animate = () => {
        const dt = Math.min(clock.getDelta(), 0.05);

        if (ballState === "serving") {
          serveTimer -= dt;
          if (serveTimer <= 0) startServe();
        } else if (ballState !== "dead") {
          bv.y += GRAV * dt;
          ball.position.addScaledVector(bv, dt);
          // bounce
          if (ball.position.y <= 0.12 && bv.y < 0) {
            ball.position.y = 0.12;
            bv.y = -bv.y * 0.65;
            bv.x *= 0.9; bv.z *= 0.9;
            // mark bounce
          }
          // check pass player (ball goes behind camera)
          if (ballState === "incoming" && ball.position.z > 12) {
            // Missed
            stateRef.current.score.cpu += 1;
            stateRef.current.setScore({ ...stateRef.current.score });
            stateRef.current.streak = 0;
            stateRef.current.setStreak(0);
            stateRef.current.setMessage("Missed! Opponent scores.");
            ballState = "dead"; serveTimer = 1.5; setTimeout(() => { ballState = "serving"; }, 1500);
          }
          // outgoing — check if past opponent
          if (ballState === "outgoing" && ball.position.z < -12) {
            stateRef.current.score.you += 1;
            stateRef.current.setScore({ ...stateRef.current.score });
            stateRef.current.setMessage("Point! You win the rally.");
            ballState = "dead"; serveTimer = 1.5; setTimeout(() => { ballState = "serving"; }, 1500);
          }
          // net check
          if (ballState === "outgoing" && Math.abs(ball.position.z) < 0.2 && ball.position.y < 1.0) {
            stateRef.current.setMessage("Into the net!");
            stateRef.current.streak = 0; stateRef.current.setStreak(0);
            stateRef.current.score.cpu += 1; stateRef.current.setScore({ ...stateRef.current.score });
            ballState = "dead"; setTimeout(() => { ballState = "serving"; }, 1500);
          }
        }

        shadow.position.set(ball.position.x, 0.02, ball.position.z);
        const s = Math.max(0.4, 1 - ball.position.y * 0.15);
        shadow.scale.set(s, s, s);

        // Racket swing animation
        if (swingRef.active) {
          swingRef.t += dt;
          const p = Math.min(swingRef.t / 0.35, 1);
          racketGroup.rotation.z = -0.3 + Math.sin(p * Math.PI) * 1.6;
          racketGroup.position.x = 0.45 - Math.sin(p * Math.PI) * 0.6;
          if (p >= 1) {
            swingRef.active = false;
            racketGroup.rotation.z = -0.3;
            racketGroup.position.x = 0.45;
          }
        }

        renderer!.render(scene, camera);
        frameId = requestAnimationFrame(animate);
      };
      animate();

      (stage as unknown as { __cleanup?: () => void }).__cleanup = () => {
        cancelAnimationFrame(frameId);
        ro.disconnect();
        window.removeEventListener("keydown", onKey);
        w.__mk9Update = prev;
        renderer?.dispose();
        if (renderer?.domElement.parentNode === stage) stage.removeChild(renderer.domElement);
      };
    })();

    return () => {
      disposed = true;
      (stage as unknown as { __cleanup?: () => void }).__cleanup?.();
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="inline-block size-2.5 rounded-full bg-primary glow-cyan animate-pulse" />
          <span className="uppercase tracking-[0.2em] text-primary">vr tennis</span>
        </div>
        <div className="flex items-center gap-6 text-muted-foreground">
          <span>YOU <span className="text-foreground text-base">{score.you}</span></span>
          <span>CPU <span className="text-foreground text-base">{score.cpu}</span></span>
          <span>STREAK <span className="text-foreground text-base">{streak}</span></span>
        </div>
      </header>
      <div className="flex-1 relative bg-black">
        <div ref={stageRef} className="absolute inset-0" />
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-sm text-white/90 bg-black/40 px-4 py-2 rounded-md">
          {message}
        </div>
      </div>
    </div>
  );
}
