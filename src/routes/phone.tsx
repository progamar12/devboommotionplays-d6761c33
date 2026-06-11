import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/phone")({
  head: () => ({
    meta: [
      { title: "Phone Camera — MoCap Bridge" },
      { name: "description", content: "Stream your phone camera to the MoCap host." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    room: typeof s.room === "string" ? s.room : "",
  }),
  component: PhonePage,
});

type Status = "idle" | "requesting" | "connecting" | "live" | "error";

function PhonePage() {
  const { room: initialRoom } = Route.useSearch();
  const [room, setRoom] = useState(initialRoom);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  async function start() {
    if (!room) {
      setStatus("error");
      setMessage("Enter the room code shown on the host.");
      return;
    }
    setStatus("requesting");
    setMessage("Requesting camera permission…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus("connecting");
      setMessage("Connecting to host…");

      const { Peer } = await import("peerjs");
      const peer = new Peer({ debug: 1 });

      peer.on("open", () => {
        const call = peer.call(room.toUpperCase(), stream);
        call.on("close", () => setStatus("idle"));
        call.on("error", (e) => {
          setStatus("error");
          setMessage(`Call error: ${e.message ?? e}`);
        });
        setStatus("live");
        setMessage("Streaming to host.");
      });
      peer.on("error", (e) => {
        setStatus("error");
        setMessage(`Peer error: ${e.type ?? e.message ?? "unknown"}`);
      });

      cleanupRef.current = () => {
        stream.getTracks().forEach((t) => t.stop());
        peer.destroy();
      };
    } catch (e) {
      const err = e as Error;
      setStatus("error");
      setMessage(err.message || "Could not access camera.");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="font-mono text-xs uppercase tracking-widest text-primary">phone · sender</div>
        <StatusPill status={status} />
      </header>

      <div className="flex-1 relative bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          autoPlay
        />
        {status !== "live" && (
          <div className="absolute inset-0 grid-bg flex items-center justify-center p-6">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-card/80 backdrop-blur p-6 space-y-4">
              <div>
                <label className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Room code
                </label>
                <input
                  value={room}
                  onChange={(e) => setRoom(e.target.value.toUpperCase().slice(0, 12))}
                  placeholder="ABCD-1234"
                  className="mt-2 w-full rounded-lg bg-background border border-border px-4 py-3 font-mono text-lg tracking-widest text-center text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <button
                onClick={start}
                disabled={status === "requesting" || status === "connecting"}
                className="w-full rounded-lg bg-primary text-primary-foreground py-3 font-semibold tracking-wide glow-cyan disabled:opacity-60"
              >
                {status === "requesting" || status === "connecting" ? "Starting…" : "Start streaming"}
              </button>
              {message && (
                <p className={`text-sm font-mono ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Tip: open this in Safari on iPhone. On first launch, allow camera access.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const color =
    status === "live" ? "bg-primary" :
    status === "error" ? "bg-destructive" :
    status === "idle" ? "bg-muted-foreground" : "bg-accent";
  return (
    <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest">
      <span className={`inline-block size-2 rounded-full ${color} animate-pulse`} />
      {status}
    </div>
  );
}
