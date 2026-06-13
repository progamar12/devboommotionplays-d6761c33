import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MoCap Bridge — Phone-to-PC motion capture" },
      {
        name: "description",
        content:
          "Stream your iPhone camera to your computer, extract a live 3D skeleton, and cast it to your TV.",
      },
      { property: "og:title", content: "MoCap Bridge" },
      { property: "og:description", content: "Live motion capture from phone to PC to TV." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen grid-bg">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-primary">
          <span className="inline-block size-2 rounded-full bg-primary glow-cyan" />
          system online
        </div>
        <h1 className="mt-6 text-5xl md:text-7xl font-semibold tracking-tight">
          MoCap <span className="glow-text text-primary">Bridge</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Stream your phone's camera to this computer. Real-time pose detection extracts
          a 3D skeleton on a grid. Mirror the host tab to your TV for big-screen mocap.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <Link
            to="/host"
            className="group relative overflow-hidden rounded-xl border border-border bg-card p-8 transition hover:border-primary hover:glow-cyan"
          >
            <div className="font-mono text-xs uppercase tracking-widest text-primary">01 · Computer</div>
            <div className="mt-3 text-2xl font-semibold">Open Host</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Display a pairing QR code, receive video, render the live 3D skeleton.
              Open this on the machine connected to your TV.
            </p>
            <div className="mt-6 font-mono text-sm text-primary">→ /host</div>
          </Link>

          <Link
            to="/phone"
            className="group relative overflow-hidden rounded-xl border border-border bg-card p-8 transition hover:border-accent"
          >
            <div className="font-mono text-xs uppercase tracking-widest text-accent">02 · Phone</div>
            <div className="mt-3 text-2xl font-semibold">Open Camera</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Open this URL on your iPhone, or scan the host's QR. Grants camera and
              streams to the host over WebRTC.
            </p>
            <div className="mt-6 font-mono text-sm text-accent">→ /phone</div>
          </Link>
        </div>

        <ol className="mt-16 grid gap-4 md:grid-cols-3 text-sm text-muted-foreground font-mono">
          <li><span className="text-primary">01.</span> Open /host on PC</li>
          <li><span className="text-primary">02.</span> Scan QR with iPhone</li>
          <li><span className="text-primary">03.</span> Cast PC tab to TV</li>
        </ol>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Link to="/games" className="block rounded-xl border border-border bg-card px-6 py-4 hover:border-primary transition">
            <div className="font-mono text-xs uppercase tracking-widest text-primary">→ Game Hub</div>
            <div className="mt-1 text-sm text-muted-foreground">Built-in games + create your own with AI</div>
          </Link>
          <Link to="/browser" className="block rounded-xl border border-border bg-card px-6 py-4 hover:border-primary transition">
            <div className="font-mono text-xs uppercase tracking-widest text-primary">→ Browser</div>
            <div className="mt-1 text-sm text-muted-foreground">Built-in Chrome-style web browser</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
