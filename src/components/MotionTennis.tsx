import { useEffect, useRef, useState } from "react";

type LM = Array<{ x: number; y: number; z: number; visibility?: number }> | null;

const W = 800;
const H = 460;
const GROUND = 400;
const NET_X = W / 2;
const NET_H = 70;

type Hand = { x: number; y: number; px: number; py: number; vx: number; vy: number; active: boolean };
type Side = {
  baseX: number; // home court center
  facing: 1 | -1;
  y: number; // jump offset (negative = up)
  vy: number;
  hands: { left: Hand; right: Hand };
  score: number;
};

type Ball = { x: number; y: number; vx: number; vy: number; spin: number; lastHit: "p1" | "p2" | null; bounced: number };

const newHand = (): Hand => ({ x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, active: false });
const newSide = (baseX: number, facing: 1 | -1): Side => ({
  baseX, facing, y: 0, vy: 0,
  hands: { left: newHand(), right: newHand() }, score: 0,
});

export function MotionTennis() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lmRef = useRef<LM>(null);
  const baselineRef = useRef<{ cx: number | null; shY: number | null }>({ cx: null, shY: null });

  const [mode, setMode] = useState<"ai" | "pvp">("ai");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const p1Ref = useRef<Side>(newSide(W * 0.25, 1));
  const p2Ref = useRef<Side>(newSide(W * 0.75, -1));
  const ballRef = useRef<Ball>({ x: W * 0.25, y: 80, vx: 240, vy: 0, spin: 0, lastHit: null, bounced: 0 });
  const keysRef = useRef<Record<string, boolean>>({});
  const [, force] = useState(0);

  // pose stream
  useEffect(() => {
    (window as unknown as { __mk9Update?: (lm: LM) => void }).__mk9Update = (lm) => { lmRef.current = lm; };
    return () => { delete (window as unknown as { __mk9Update?: unknown }).__mk9Update; };
  }, []);

  // keyboard for P2 (pvp) — arrow keys move racket, Space jump, Z/X swing left/right hand
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = true; };
    const up = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = false; };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);

  const resetBall = (toward: "p1" | "p2") => {
    const b = ballRef.current;
    b.x = toward === "p1" ? W * 0.7 : W * 0.3;
    b.y = 60;
    b.vx = toward === "p1" ? -260 : 260;
    b.vy = 0;
    b.spin = 0;
    b.lastHit = null;
    b.bounced = 0;
  };

  useEffect(() => {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    // P2 fake hand state for pvp
    const p2Cursor = { x: W * 0.75, y: GROUND - 100, lx: W * 0.7, ly: GROUND - 100, rx: W * 0.8, ry: GROUND - 100 };

    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      const lm = lmRef.current;
      const p1 = p1Ref.current;
      const p2 = p2Ref.current;
      const ball = ballRef.current;

      // ---------- P1 from pose ----------
      if (lm && lm.length >= 17) {
        const lSh = lm[11], rSh = lm[12];
        const lWr = lm[15], rWr = lm[16];
        const cx = (lSh.x + rSh.x) / 2;
        const shY = (lSh.y + rSh.y) / 2;
        if (baselineRef.current.cx === null) baselineRef.current.cx = cx;
        if (baselineRef.current.shY === null) baselineRef.current.shY = shY;
        baselineRef.current.cx = baselineRef.current.cx! * 0.99 + cx * 0.01;
        baselineRef.current.shY = baselineRef.current.shY! * 0.995 + shY * 0.005;

        // jump: shoulder rises rapidly
        if (p1.y >= 0) {
          const rise = baselineRef.current.shY! - shY;
          if (rise > 0.06) p1.vy = -380;
        }

        // map wrists to court — P1 owns LEFT half (x: 0..NET_X-20)
        const halfW = NET_X - 40;
        const mapHand = (h: Hand, wr: { x: number; y: number }) => {
          // mirror x (host already mirrors preview); use 1-wr.x so user sees natural movement
          const nx = 1 - wr.x;
          const ny = wr.y;
          const tx = 20 + nx * halfW;
          const ty = 40 + ny * (GROUND - 60);
          h.px = h.x; h.py = h.y;
          h.x = h.x * 0.4 + tx * 0.6;
          h.y = h.y * 0.4 + ty * 0.6;
          h.vx = (h.x - h.px) / Math.max(dt, 0.001);
          h.vy = (h.y - h.py) / Math.max(dt, 0.001);
          h.active = true;
        };
        mapHand(p1.hands.left, lWr);
        mapHand(p1.hands.right, rWr);
      }

      // ---------- P2 ----------
      if (modeRef.current === "ai") {
        // AI tracks ball when it's on its side
        const tx = ball.x < NET_X ? p2.baseX : Math.max(NET_X + 60, Math.min(W - 40, ball.x));
        const ty = ball.x < NET_X ? GROUND - 120 : Math.max(60, Math.min(GROUND - 30, ball.y));
        p2Cursor.x += (tx - p2Cursor.x) * Math.min(1, dt * 4.5);
        p2Cursor.y += (ty - p2Cursor.y) * Math.min(1, dt * 6);
        // jump if ball high & close
        if (p2.y >= 0 && ball.x > NET_X && ball.y < 220 && Math.abs(ball.x - p2.baseX) < 180) p2.vy = -360;
      } else {
        const k = keysRef.current;
        const sp = 320;
        if (k["arrowleft"]) p2Cursor.x -= sp * dt;
        if (k["arrowright"]) p2Cursor.x += sp * dt;
        if (k["arrowup"]) p2Cursor.y -= sp * dt;
        if (k["arrowdown"]) p2Cursor.y += sp * dt;
        if (k[" "] && p2.y >= 0) p2.vy = -380;
        p2Cursor.x = Math.max(NET_X + 20, Math.min(W - 40, p2Cursor.x));
        p2Cursor.y = Math.max(40, Math.min(GROUND - 30, p2Cursor.y));
      }
      // P2 two hands flanking cursor; swing impulses
      const swingL = modeRef.current === "ai"
        ? (ball.x > NET_X && Math.abs(ball.x - p2Cursor.x) < 90 && Math.abs(ball.y - p2Cursor.y) < 80 ? 1 : 0)
        : (keysRef.current["z"] ? 1 : 0);
      const swingR = modeRef.current === "ai"
        ? swingL
        : (keysRef.current["x"] ? 1 : 0);
      const setP2Hand = (h: Hand, tx: number, ty: number, swinging: number) => {
        h.px = h.x; h.py = h.y;
        h.x = tx; h.y = ty;
        h.vx = swinging ? -600 : (h.x - h.px) / Math.max(dt, 0.001);
        h.vy = swinging ? -120 : (h.y - h.py) / Math.max(dt, 0.001);
        h.active = true;
      };
      setP2Hand(p2.hands.left, p2Cursor.x - 26, p2Cursor.y, swingL);
      setP2Hand(p2.hands.right, p2Cursor.x + 26, p2Cursor.y, swingR);

      // ---------- jump physics ----------
      for (const s of [p1, p2]) {
        s.vy += 900 * dt;
        s.y += s.vy * dt;
        if (s.y > 0) { s.y = 0; s.vy = 0; }
      }

      // ---------- ball physics ----------
      ball.vy += 700 * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // bounce on ground anywhere on screen
      if (ball.y > GROUND - 8) {
        ball.y = GROUND - 8;
        ball.vy = -ball.vy * 0.72;
        ball.vx *= 0.92;
        ball.bounced++;
        if (ball.bounced >= 2) {
          // point: opponent of lastHit scores, or whoever's side ball is on loses
          const onLeft = ball.x < NET_X;
          if (ball.lastHit === "p1" && !onLeft) p1.score++;
          else if (ball.lastHit === "p2" && onLeft) p2.score++;
          else if (onLeft) p2.score++; else p1.score++;
          resetBall(onLeft ? "p1" : "p2");
        }
      }
      // walls
      if (ball.x < 8) { ball.x = 8; ball.vx = Math.abs(ball.vx) * 0.8; }
      if (ball.x > W - 8) { ball.x = W - 8; ball.vx = -Math.abs(ball.vx) * 0.8; }
      // net
      if (ball.x > NET_X - 4 && ball.x < NET_X + 4 && ball.y > GROUND - NET_H) {
        ball.vx = -ball.vx * 0.4;
        ball.x += ball.vx * dt;
      }

      // ---------- hand-ball collisions ----------
      const tryHit = (h: Hand, owner: "p1" | "p2") => {
        if (!h.active) return;
        const dx = ball.x - h.x, dy = ball.y - h.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 38 * 38) {
          const speed = Math.hypot(h.vx, h.vy);
          if (speed < 250 && ball.lastHit === owner) return; // not enough swing
          // direction: toward opposite court
          const dir = owner === "p1" ? 1 : -1;
          const power = Math.min(900, 280 + speed * 0.6);
          ball.vx = dir * power * (0.7 + Math.random() * 0.4);
          ball.vy = -(180 + Math.random() * 260) + h.vy * 0.3;
          ball.lastHit = owner;
          ball.bounced = 0;
        }
      };
      tryHit(p1.hands.left, "p1");
      tryHit(p1.hands.right, "p1");
      tryHit(p2.hands.left, "p2");
      tryHit(p2.hands.right, "p2");

      // ---------- render ----------
      ctx.clearRect(0, 0, W, H);
      // sky
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#0a1530"); g.addColorStop(1, "#0d2a3a");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // court
      ctx.fillStyle = "#1e6e3a"; ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, GROUND); ctx.lineTo(W, GROUND); ctx.stroke();
      // court lines (perspective fake)
      ctx.beginPath(); ctx.moveTo(60, H - 6); ctx.lineTo(W - 60, H - 6); ctx.stroke();
      // net
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(NET_X - 2, GROUND - NET_H, 4, NET_H);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(NET_X - 30, GROUND - NET_H + i * (NET_H / 8));
        ctx.lineTo(NET_X + 30, GROUND - NET_H + i * (NET_H / 8));
        ctx.stroke();
      }

      // players
      drawPlayer(ctx, p1.baseX, GROUND + p1.y, "#00e6ff", 1);
      drawPlayer(ctx, p2.baseX, GROUND + p2.y, "#ff44cc", -1);

      // rackets at hands
      drawRacket(ctx, p1.hands.left, "#00e6ff");
      drawRacket(ctx, p1.hands.right, "#00e6ff");
      drawRacket(ctx, p2.hands.left, "#ff44cc");
      drawRacket(ctx, p2.hands.right, "#ff44cc");

      // ball + shadow
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath(); ctx.ellipse(ball.x, GROUND - 2, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e9ff5a";
      ctx.beginPath(); ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1; ctx.stroke();

      // HUD
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${p1.score}  :  ${p2.score}`, W / 2, 30);
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillStyle = "#00e6ff"; ctx.textAlign = "left";
      ctx.fillText("YOU (motion)", 16, 24);
      ctx.fillStyle = "#ff44cc"; ctx.textAlign = "right";
      ctx.fillText(modeRef.current === "ai" ? "AI" : "P2 (arrows/space, Z/X swing)", W - 16, 24);

      force((n) => (n + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 font-mono text-xs">
        <div className="text-primary uppercase tracking-widest">Motion Tennis</div>
        <div className="flex rounded-md overflow-hidden border border-border">
          <button onClick={() => setMode("ai")}
            className={`px-3 py-1.5 ${mode === "ai" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>vs AI</button>
          <button onClick={() => setMode("pvp")}
            className={`px-3 py-1.5 ${mode === "pvp" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>vs P2</button>
        </div>
        <button onClick={() => { p1Ref.current.score = 0; p2Ref.current.score = 0; resetBall("p2"); }}
          className="px-3 py-1.5 border border-border rounded-md hover:bg-accent">Reset</button>
      </div>
      <canvas ref={canvasRef} width={W} height={H} className="w-full rounded-lg border border-border bg-black" />
      <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
        Swing either fist like a racket to hit the ball. Jump by jumping IRL. Ball can bounce anywhere on the court — let it bounce twice and the point is lost.
        {" "}In <b>vs P2</b> mode the second player uses Arrow keys to move, Space to jump, Z/X to swing left/right racket.
      </p>
    </div>
  );
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, facing: 1 | -1) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 4;
  // legs
  ctx.beginPath(); ctx.moveTo(x, y - 50); ctx.lineTo(x - 12, y); ctx.moveTo(x, y - 50); ctx.lineTo(x + 12, y); ctx.stroke();
  // torso
  ctx.beginPath(); ctx.moveTo(x, y - 50); ctx.lineTo(x, y - 110); ctx.stroke();
  // head
  ctx.beginPath(); ctx.arc(x, y - 125, 14, 0, Math.PI * 2); ctx.fill();
  // facing eye
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.arc(x + facing * 4, y - 127, 2, 0, Math.PI * 2); ctx.fill();
}

function drawRacket(ctx: CanvasRenderingContext2D, h: Hand, color: string) {
  if (!h.active) return;
  const ang = Math.atan2(h.vy, h.vx);
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(ang + Math.PI / 2);
  // handle
  ctx.fillStyle = "#3a2a1a";
  ctx.fillRect(-3, 0, 6, 34);
  // grip wrap
  ctx.fillStyle = color;
  ctx.fillRect(-4, 26, 8, 10);
  // head (oval)
  ctx.strokeStyle = "#ddd"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, -10, 16, 22, 0, 0, Math.PI * 2); ctx.stroke();
  // strings
  ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1;
  for (let i = -12; i <= 12; i += 4) {
    ctx.beginPath(); ctx.moveTo(i, -28); ctx.lineTo(i, 8); ctx.stroke();
  }
  for (let i = -28; i <= 8; i += 4) {
    ctx.beginPath(); ctx.moveTo(-14, i); ctx.lineTo(14, i); ctx.stroke();
  }
  // wrist dot
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 36, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
