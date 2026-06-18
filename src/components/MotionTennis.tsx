import { useEffect, useRef, useState } from "react";

type LM = Array<{ x: number; y: number; z: number; visibility?: number }> | null;

// Shared zero-gravity arena (world coords)
const AW = 800;
const AH = 500;
const NET_X = AW / 2;

// Each first-person panel renders the SAME arena from one player's POV.
const PANEL_W = 420;
const PANEL_H = 500;

type Hand = { x: number; y: number; px: number; py: number; vx: number; vy: number; active: boolean };
type Side = { hands: { left: Hand; right: Hand }; score: number };
type Ball = { x: number; y: number; vx: number; vy: number; lastHit: "p1" | "p2" | null };

const newHand = (): Hand => ({ x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, active: false });
const newSide = (): Side => ({ hands: { left: newHand(), right: newHand() }, score: 0 });

export function MotionTennis() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lmRef = useRef<LM>(null);

  const [mode, setMode] = useState<"ai" | "pvp">("ai");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const p1Ref = useRef<Side>(newSide());
  const p2Ref = useRef<Side>(newSide());
  const ballRef = useRef<Ball>({ x: AW * 0.3, y: AH * 0.5, vx: 320, vy: 80, lastHit: null });
  const [, force] = useState(0);

  useEffect(() => {
    (window as unknown as { __mk9Update?: (lm: LM) => void }).__mk9Update = (lm) => { lmRef.current = lm; };
    return () => { delete (window as unknown as { __mk9Update?: unknown }).__mk9Update; };
  }, []);

  const resetBall = (toward: "p1" | "p2") => {
    const b = ballRef.current;
    b.x = toward === "p1" ? AW * 0.7 : AW * 0.3;
    b.y = AH * 0.4 + Math.random() * AH * 0.2;
    b.vx = (toward === "p1" ? -1 : 1) * (260 + Math.random() * 120);
    b.vy = (Math.random() - 0.5) * 300;
    b.lastHit = null;
  };

  useEffect(() => {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    // P2 AI cursor for solo mode
    const ai = { lx: AW * 0.78, ly: AH * 0.5, rx: AW * 0.86, ry: AH * 0.5 };

    const updateHand = (h: Hand, tx: number, ty: number, dt: number, lerp = 0.55) => {
      h.px = h.x; h.py = h.y;
      h.x = h.x * (1 - lerp) + tx * lerp;
      h.y = h.y * (1 - lerp) + ty * lerp;
      h.vx = (h.x - h.px) / Math.max(dt, 0.001);
      h.vy = (h.y - h.py) / Math.max(dt, 0.001);
      h.active = true;
    };

    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      const lm = lmRef.current;
      const p1 = p1Ref.current;
      const p2 = p2Ref.current;
      const ball = ballRef.current;

      // ---------- Map pose to hands ----------
      // P1 always owns LEFT half of arena. P2 owns RIGHT half (or AI).
      if (lm && lm.length >= 17) {
        const lWr = lm[15], rWr = lm[16];
        // Mirror x so user moves naturally
        const nxL = 1 - lWr.x, nyL = lWr.y;
        const nxR = 1 - rWr.x, nyR = rWr.y;

        if (modeRef.current === "pvp") {
          // Person on camera-left controls P1; camera-right controls P2.
          // After mirror: nx<0.5 => left-of-camera person.
          // Route each wrist into its side's hand slot.
          const wrists = [
            { nx: nxL, ny: nyL },
            { nx: nxR, ny: nyR },
          ];
          let p1i = 0, p2i = 0;
          for (const w of wrists) {
            if (w.nx < 0.5) {
              const h = p1i === 0 ? p1.hands.left : p1.hands.right; p1i++;
              const tx = Math.max(0, Math.min(1, w.nx * 2)) * (NET_X - 20);
              const ty = w.ny * AH;
              updateHand(h, tx, ty, dt);
            } else {
              const h = p2i === 0 ? p2.hands.left : p2.hands.right; p2i++;
              const tx = NET_X + 20 + Math.max(0, Math.min(1, (w.nx - 0.5) * 2)) * (NET_X - 20);
              const ty = w.ny * AH;
              updateHand(h, tx, ty, dt);
            }
          }
          // mark unused hands inactive
          if (p1i === 0) { p1.hands.left.active = false; p1.hands.right.active = false; }
          else if (p1i === 1) p1.hands.right.active = false;
          if (p2i === 0) { p2.hands.left.active = false; p2.hands.right.active = false; }
          else if (p2i === 1) p2.hands.right.active = false;
        } else {
          // Solo: both wrists belong to P1, mapped across the LEFT half
          const tx1 = nxL * (NET_X - 20);
          const ty1 = nyL * AH;
          const tx2 = nxR * (NET_X - 20);
          const ty2 = nyR * AH;
          updateHand(p1.hands.left, tx1, ty1, dt);
          updateHand(p1.hands.right, tx2, ty2, dt);
        }
      }

      // ---------- P2 AI ----------
      if (modeRef.current === "ai") {
        // Track ball when it's on right side; otherwise wait near center-right
        const targetX = ball.x > NET_X ? Math.max(NET_X + 40, Math.min(AW - 40, ball.x + 20)) : AW * 0.78;
        const targetY = ball.x > NET_X ? Math.max(40, Math.min(AH - 40, ball.y)) : AH * 0.5;
        const k = Math.min(1, dt * 6);
        ai.lx += (targetX - 30 - ai.lx) * k;
        ai.ly += (targetY - ai.ly) * k;
        ai.rx += (targetX + 30 - ai.rx) * k;
        ai.ry += (targetY - ai.ry) * k;
        const swinging = ball.x > NET_X && Math.abs(ball.x - targetX) < 100;
        const sx = swinging ? -700 : 0;
        const setAi = (h: Hand, tx: number, ty: number) => {
          h.px = h.x; h.py = h.y; h.x = tx; h.y = ty;
          h.vx = sx + (h.x - h.px) / Math.max(dt, 0.001);
          h.vy = (h.y - h.py) / Math.max(dt, 0.001);
          h.active = true;
        };
        setAi(p2.hands.left, ai.lx, ai.ly);
        setAi(p2.hands.right, ai.rx, ai.ry);
      }

      // ---------- ZERO-GRAVITY ball physics ----------
      // No gravity. Pure inertia. Bounces off all four walls and the net.
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // Top / bottom walls -> bounce, no score
      if (ball.y < 8) { ball.y = 8; ball.vy = Math.abs(ball.vy); }
      if (ball.y > AH - 8) { ball.y = AH - 8; ball.vy = -Math.abs(ball.vy); }

      // Net in the middle column (full height since zero-G)
      if (ball.x > NET_X - 5 && ball.x < NET_X + 5) {
        if (ball.vx > 0) ball.x = NET_X - 5; else ball.x = NET_X + 5;
        ball.vx = -ball.vx * 0.6;
      }

      // Left / right BACK walls -> point scored against that side
      if (ball.x < 8) {
        p2.score++;
        resetBall("p1");
      } else if (ball.x > AW - 8) {
        p1.score++;
        resetBall("p2");
      }

      // Hand collisions
      const tryHit = (h: Hand, owner: "p1" | "p2") => {
        if (!h.active) return;
        const dx = ball.x - h.x, dy = ball.y - h.y;
        if (dx * dx + dy * dy < 40 * 40) {
          const speed = Math.hypot(h.vx, h.vy);
          if (speed < 200 && ball.lastHit === owner) return;
          const dir = owner === "p1" ? 1 : -1;
          const power = Math.min(900, 300 + speed * 0.55);
          // Aim toward opponent side, plus hand-velocity influence for vertical aim
          ball.vx = dir * power * (0.75 + Math.random() * 0.35);
          ball.vy = h.vy * 0.5 + (Math.random() - 0.5) * 240;
          ball.lastHit = owner;
        }
      };
      tryHit(p1.hands.left, "p1");
      tryHit(p1.hands.right, "p1");
      tryHit(p2.hands.left, "p2");
      tryHit(p2.hands.right, "p2");

      // ---------- render ----------
      ctx.clearRect(0, 0, PANEL_W * 2 + 8, PANEL_H);
      drawPanel(ctx, 0, p1, p2, ball, "p1");
      // divider gap
      ctx.fillStyle = "#000";
      ctx.fillRect(PANEL_W, 0, 8, PANEL_H);
      drawPanel(ctx, PANEL_W + 8, p2, p1, ball, "p2");

      force((n) => (n + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const totalW = PANEL_W * 2 + 8;

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 font-mono text-xs">
        <div className="text-primary uppercase tracking-widest">First-Person Zero-G Tennis</div>
        <div className="flex rounded-md overflow-hidden border border-border">
          <button onClick={() => setMode("ai")}
            className={`px-3 py-1.5 ${mode === "ai" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>vs AI</button>
          <button onClick={() => setMode("pvp")}
            className={`px-3 py-1.5 ${mode === "pvp" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>vs P2</button>
        </div>
        <button onClick={() => { p1Ref.current.score = 0; p2Ref.current.score = 0; resetBall("p2"); }}
          className="px-3 py-1.5 border border-border rounded-md hover:bg-accent">Reset</button>
      </div>
      <canvas ref={canvasRef} width={totalW} height={PANEL_H} className="w-full rounded-lg border border-border bg-black" />
      <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
        Split-screen first-person view. The ball floats in zero gravity and bounces off every wall — score by getting it past your opponent&apos;s back wall. In <b>vs P2</b>, both players stand in front of the camera (left side controls left panel, right side controls right panel). Swing your fists to hit.
      </p>
    </div>
  );
}

// ---------- rendering ----------
// Each panel is a first-person POV of the SAME arena.
// `me` is the viewing player. World x is remapped so "forward" is into the screen (away from me at top),
// and "me" sits visually at the bottom of the panel with rackets in foreground.
function drawPanel(
  ctx: CanvasRenderingContext2D,
  ox: number,
  me: Side,
  opp: Side,
  ball: Ball,
  who: "p1" | "p2"
) {
  const myColor = who === "p1" ? "#00e6ff" : "#ff44cc";
  const oppColor = who === "p1" ? "#ff44cc" : "#00e6ff";

  // Build a per-panel transform:
  // For P1 (owns left half world x in [0, NET_X]): "my side" is left, opp is right.
  // For P2 (owns right half world x in [NET_X, AW]): mirror so opp is at top of panel.
  // We render the WHOLE arena rotated so the player's net is at the TOP of the panel and back wall at the BOTTOM.
  // World mapping: worldX -> panelY (depth), worldY -> panelX (lateral).
  //   For P1: depth0 (player back wall) = world x=0 -> panelY = PANEL_H; net world x=NET_X -> panelY=0; beyond net -> negative => clipped.
  //   We show opponent's half as a "horizon" strip at top.
  // To keep it simple and readable, we draw a flat top-down view rotated 90deg per player.

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, 0, PANEL_W, PANEL_H);
  ctx.clip();

  // background gradient (deep space-ish for zero-g)
  const g = ctx.createLinearGradient(ox, 0, ox, PANEL_H);
  g.addColorStop(0, "#0b0d24");
  g.addColorStop(1, "#1a0d2b");
  ctx.fillStyle = g;
  ctx.fillRect(ox, 0, PANEL_W, PANEL_H);

  // starfield
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 40; i++) {
    const sx = ox + ((i * 97) % PANEL_W);
    const sy = (i * 53) % PANEL_H;
    ctx.fillRect(sx, sy, 1, 1);
  }

  // Convert world (wx, wy) -> panel coords (px, py) per viewer
  // depth = how far from MY back wall (0 = at me, 1 = at far wall)
  const worldToPanel = (wx: number, wy: number) => {
    let depth: number;
    if (who === "p1") {
      // my back wall is wx=0, far wall is wx=AW
      depth = wx / AW;
    } else {
      // my back wall is wx=AW, far wall is wx=0
      depth = (AW - wx) / AW;
      wy = AH - wy; // mirror lateral so left-from-my-POV stays consistent
    }
    // perspective scaling: things farther away get smaller
    const scale = 1 - depth * 0.6; // 1 at me, 0.4 at far wall
    // depth maps to vertical position on panel: 0 (me) -> bottom, 1 (far) -> top
    const py = PANEL_H - depth * PANEL_H * 0.95 - 10;
    // wy (0..AH) maps to lateral, centered, scaled by perspective
    const lateralNorm = (wy / AH) - 0.5; // -0.5..0.5
    const px = ox + PANEL_W / 2 + lateralNorm * PANEL_W * scale * 1.1;
    return { px, py, scale };
  };

  // Court floor — perspective trapezoid (my side: bottom half of panel)
  ctx.fillStyle = "#0f3a1f";
  const fl = worldToPanel(who === "p1" ? 0 : AW, 0);
  const fr = worldToPanel(who === "p1" ? 0 : AW, AH);
  const bl = worldToPanel(who === "p1" ? NET_X : NET_X, 0);
  const br = worldToPanel(who === "p1" ? NET_X : NET_X, AH);
  ctx.beginPath();
  ctx.moveTo(fl.px, fl.py); ctx.lineTo(fr.px, fr.py);
  ctx.lineTo(br.px, br.py); ctx.lineTo(bl.px, bl.py);
  ctx.closePath(); ctx.fill();

  // Far court (opponent side) — fainter
  ctx.fillStyle = "#0a2a17";
  const ffl = worldToPanel(who === "p1" ? AW : 0, 0);
  const ffr = worldToPanel(who === "p1" ? AW : 0, AH);
  ctx.beginPath();
  ctx.moveTo(bl.px, bl.py); ctx.lineTo(br.px, br.py);
  ctx.lineTo(ffr.px, ffr.py); ctx.lineTo(ffl.px, ffl.py);
  ctx.closePath(); ctx.fill();

  // Court center line (lateral midline)
  ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1;
  const cl = worldToPanel(who === "p1" ? 0 : AW, AH / 2);
  const cm = worldToPanel(who === "p1" ? AW : 0, AH / 2);
  ctx.beginPath(); ctx.moveTo(cl.px, cl.py); ctx.lineTo(cm.px, cm.py); ctx.stroke();

  // Net at NET_X — drawn as horizontal-ish band across the panel at mid-depth
  const nl = worldToPanel(NET_X, 0);
  const nr = worldToPanel(NET_X, AH);
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(nl.px, nl.py - 30); ctx.lineTo(nr.px, nr.py - 30); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const x = nl.px + (nr.px - nl.px) * t;
    const yTop = (nl.py + (nr.py - nl.py) * t) - 30;
    const yBot = nl.py + (nr.py - nl.py) * t;
    ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBot); ctx.stroke();
  }

  // Opponent silhouette across the court (at far wall center)
  const oppPos = worldToPanel(who === "p1" ? AW - 60 : 60, AH / 2);
  drawOpponent(ctx, oppPos.px, oppPos.py, oppPos.scale, oppColor);

  // Opponent's rackets (small, far away)
  for (const h of [opp.hands.left, opp.hands.right]) {
    if (!h.active) continue;
    const p = worldToPanel(h.x, h.y);
    drawRacketAt(ctx, p.px, p.py, p.scale * 0.7, Math.atan2(h.vy, h.vx) + Math.PI / 2, oppColor);
  }

  // Ball
  const bp = worldToPanel(ball.x, ball.y);
  // trail / glow
  ctx.fillStyle = "rgba(233,255,90,0.25)";
  ctx.beginPath(); ctx.arc(bp.px, bp.py, 14 * bp.scale + 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e9ff5a";
  ctx.beginPath(); ctx.arc(bp.px, bp.py, 9 * bp.scale + 3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();

  // MY rackets (big, foreground)
  for (const h of [me.hands.left, me.hands.right]) {
    if (!h.active) continue;
    const p = worldToPanel(h.x, h.y);
    drawRacketAt(ctx, p.px, p.py, Math.max(1.0, p.scale * 1.3), Math.atan2(h.vy, h.vx) + Math.PI / 2, myColor);
  }

  // HUD: my score (big) + opponent score (small)
  ctx.fillStyle = myColor;
  ctx.font = "bold 28px ui-monospace, monospace"; ctx.textAlign = "left";
  ctx.fillText(`${me.score}`, ox + 14, 36);
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.fillText(who === "p1" ? "P1 (YOU)" : "P2 (YOU)", ox + 14, 52);
  ctx.fillStyle = oppColor;
  ctx.font = "bold 16px ui-monospace, monospace"; ctx.textAlign = "right";
  ctx.fillText(`${opp.score}`, ox + PANEL_W - 14, 30);
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.fillText("OPP", ox + PANEL_W - 14, 44);

  // Win banner
  if (me.score >= 7 || opp.score >= 7) {
    const youWin = me.score > opp.score;
    ctx.fillStyle = youWin ? "rgba(0,230,255,0.85)" : "rgba(255,68,204,0.85)";
    ctx.fillRect(ox + 20, PANEL_H / 2 - 24, PANEL_W - 40, 48);
    ctx.fillStyle = "#000"; ctx.font = "bold 18px ui-monospace, monospace"; ctx.textAlign = "center";
    ctx.fillText(youWin ? "YOU WIN!" : "YOU LOSE", ox + PANEL_W / 2, PANEL_H / 2 + 6);
  }

  // panel border
  ctx.strokeStyle = myColor; ctx.lineWidth = 2;
  ctx.strokeRect(ox + 1, 1, PANEL_W - 2, PANEL_H - 2);

  ctx.restore();
}

function drawOpponent(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string) {
  const s = Math.max(0.4, scale);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3 * s;
  // legs
  ctx.beginPath();
  ctx.moveTo(x, y - 50 * s); ctx.lineTo(x - 10 * s, y);
  ctx.moveTo(x, y - 50 * s); ctx.lineTo(x + 10 * s, y);
  ctx.stroke();
  // torso
  ctx.beginPath(); ctx.moveTo(x, y - 50 * s); ctx.lineTo(x, y - 100 * s); ctx.stroke();
  // head
  ctx.beginPath(); ctx.arc(x, y - 112 * s, 12 * s, 0, Math.PI * 2); ctx.fill();
}

function drawRacketAt(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, ang: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(scale, scale);
  // handle
  ctx.fillStyle = "#3a2a1a";
  ctx.fillRect(-3, 0, 6, 40);
  // grip
  ctx.fillStyle = color;
  ctx.fillRect(-4, 30, 8, 12);
  // head (oval)
  ctx.strokeStyle = "#eee"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, -14, 20, 26, 0, 0, Math.PI * 2); ctx.stroke();
  // strings
  ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1;
  for (let i = -16; i <= 16; i += 4) {
    ctx.beginPath(); ctx.moveTo(i, -36); ctx.lineTo(i, 10); ctx.stroke();
  }
  for (let i = -36; i <= 10; i += 4) {
    ctx.beginPath(); ctx.moveTo(-18, i); ctx.lineTo(18, i); ctx.stroke();
  }
  // wrist
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 42, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
