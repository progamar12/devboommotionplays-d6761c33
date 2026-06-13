import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

export const Route = createFileRoute("/browser")({
  head: () => ({
    meta: [
      { title: "Browser — MoCap Bridge" },
      { name: "description", content: "Built-in web browser." },
    ],
  }),
  component: BrowserPage,
});

const HOME = "https://www.google.com/webhp?igu=1";

function normalizeUrl(input: string): string {
  const v = input.trim();
  if (!v) return HOME;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(v)) return `https://${v}`;
  return `https://www.google.com/search?igu=1&q=${encodeURIComponent(v)}`;
}

function BrowserPage() {
  const [url, setUrl] = useState(HOME);
  const [input, setInput] = useState(HOME);
  const [tick, setTick] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const go = (next: string) => {
    const u = normalizeUrl(next);
    setUrl(u);
    setInput(u);
    setTick((t) => t + 1);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(input);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Link to="/" className="font-mono text-xs uppercase tracking-widest text-primary hover:underline">
          ← home
        </Link>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => iframeRef.current?.contentWindow?.history.back()}
            className="size-8 rounded hover:bg-muted"
            aria-label="Back"
          >
            ←
          </button>
          <button
            onClick={() => iframeRef.current?.contentWindow?.history.forward()}
            className="size-8 rounded hover:bg-muted"
            aria-label="Forward"
          >
            →
          </button>
          <button
            onClick={() => setTick((t) => t + 1)}
            className="size-8 rounded hover:bg-muted"
            aria-label="Reload"
          >
            ⟳
          </button>
          <button
            onClick={() => go(HOME)}
            className="size-8 rounded hover:bg-muted"
            aria-label="Home"
          >
            ⌂
          </button>
        </div>
        <form onSubmit={onSubmit} className="flex-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full rounded-full border border-border bg-background px-4 py-1.5 text-sm font-mono outline-none focus:border-primary"
            placeholder="Search Google or type a URL"
            spellCheck={false}
          />
        </form>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-mono text-muted-foreground hover:text-primary"
        >
          open ↗
        </a>
      </div>

      <iframe
        key={tick}
        ref={iframeRef}
        src={url}
        className="flex-1 w-full bg-white"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        title="browser"
      />

      <div className="border-t border-border bg-card px-3 py-1 text-[10px] font-mono text-muted-foreground">
        Note: some sites (e.g. youtube.com) refuse to load inside frames — use "open ↗" to launch them in a new tab.
      </div>
    </div>
  );
}
