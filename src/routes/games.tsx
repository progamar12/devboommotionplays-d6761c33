import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { generateAiGame } from "@/lib/aiGames.functions";

export const Route = createFileRoute("/games")({
  head: () => ({
    meta: [
      { title: "Game Hub — MoCap Bridge" },
      { name: "description", content: "Play built-in motion games and create your own with AI." },
    ],
  }),
  component: GamesPage,
});

type UserGame = { id: string; title: string; idea: string; html: string; createdAt: number };

const STORAGE_KEY = "mocap.userGames.v1";

function loadGames(): UserGame[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveGames(games: UserGame[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
}

function GamesPage() {
  const generate = useServerFn(generateAiGame);
  const [idea, setIdea] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [games, setGames] = useState<UserGame[]>([]);
  const [active, setActive] = useState<UserGame | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => setGames(loadGames()), []);

  const onCreate = async () => {
    if (!idea.trim()) return;
    setBusy(true); setError(null);
    try {
      const { html } = await generate({ data: { idea } });
      const g: UserGame = {
        id: crypto.randomUUID(),
        title: title.trim() || idea.slice(0, 40),
        idea, html, createdAt: Date.now(),
      };
      const next = [g, ...games];
      setGames(next); saveGames(next);
      setIdea(""); setTitle("");
      setActive(g);
    } catch (e) {
      setError((e as Error).message || "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = (id: string) => {
    const next = games.filter((g) => g.id !== id);
    setGames(next); saveGames(next);
    if (active?.id === id) setActive(null);
  };

  return (
    <div className="min-h-screen grid-bg">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block size-2.5 rounded-full bg-primary glow-cyan animate-pulse" />
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">game hub</div>
        </div>
        <nav className="font-mono text-xs flex gap-4">
          <Link to="/" className="text-muted-foreground hover:text-primary">/ home</Link>
          <Link to="/host" className="text-muted-foreground hover:text-primary">/ host</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 space-y-10">
        <section>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
            Game <span className="text-primary glow-text">Hub</span>
          </h1>
          <p className="mt-3 text-muted-foreground max-w-2xl">
            Built-in motion games plus an AI creator that spins up playable mini-games from a one-line idea.
          </p>
        </section>

        <section>
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary mb-3">Built-in</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Link to="/host" className="rounded-xl border border-border bg-card p-6 hover:border-primary transition">
              <div className="font-mono text-xs text-primary">MK9 · MOTION FIGHTER</div>
              <div className="mt-2 text-xl font-semibold">Stickman Brawler</div>
              <p className="mt-1 text-sm text-muted-foreground">Use your body to kick, punch, dodge a bot. Opens inside the Host view.</p>
            </Link>
          </div>
        </section>

        <section>
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary mb-3">Create with AI</h2>
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            />
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Describe a game. e.g. 'Catch falling stars with a paddle, avoid bombs, score goes up over time'"
              rows={3}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={onCreate}
                disabled={busy || !idea.trim()}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest disabled:opacity-50"
              >
                {busy ? "Generating…" : "Generate game"}
              </button>
              {error && <span className="text-xs text-red-400 font-mono">{error}</span>}
            </div>
            <p className="text-[11px] text-muted-foreground font-mono">
              Games run sandboxed in your browser. Saved locally on this device.
            </p>
          </div>
        </section>

        <section>
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary mb-3">
            Your games ({games.length})
          </h2>
          {games.length === 0 ? (
            <div className="text-sm text-muted-foreground">None yet. Generate one above.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {games.map((g) => (
                <div key={g.id} className={`rounded-xl border p-4 bg-card ${active?.id === g.id ? "border-primary" : "border-border"}`}>
                  <div className="font-semibold truncate">{g.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{g.idea}</div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setActive(g)} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-mono text-[11px] uppercase">Play</button>
                    <button onClick={() => onDelete(g.id)} className="px-3 py-1.5 rounded-md border border-border font-mono text-[11px] uppercase hover:border-red-400 hover:text-red-400">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {active && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Now playing · {active.title}</h2>
              <button onClick={() => setActive(null)} className="font-mono text-[11px] text-muted-foreground hover:text-primary uppercase">Close</button>
            </div>
            <div className="rounded-xl border border-border overflow-hidden bg-black aspect-video">
              <iframe
                ref={iframeRef}
                key={active.id}
                title={active.title}
                srcDoc={active.html}
                sandbox="allow-scripts"
                className="w-full h-full"
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
