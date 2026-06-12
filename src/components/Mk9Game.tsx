import { useEffect, useRef, useState } from "react";

type LM = Array<{ x: number; y: number; z: number; visibility?: number }> | null;

type Fighter = {
  x: number;
  y: number; // vertical offset (0 = ground, negative = in air)
  vy: number;
  crouch: number; // 0..1
  kick: number; // 0..1 animation
  kickHeight: number; // 0..1 (0=leg, 0.5=body, 1=head)
  kickCooldown: number;
  punch: number;
  punchCooldown: number;
  hp: number;
  height: number; // pixel height
  color: string;
  facing: 1 | -1;
};

type BotState = Fighter & {
  attackTimer: number;
  attacking: number;
  attackKind: "kick" | "punch";
  attackHeight: number;
};

const ARENA_W = 800;
const ARENA_H = 460;
const GROUND_Y = 400;
const REACH = 110;
const MAX_HP = 150;

const COLORS = ["#00e6ff", "#ff44cc", "#ffd400", "#7CFF6B", "#ff7a00"];

type Difficulty = 1 | 2 | 3;

const DIFF_CFG: Record<Difficulty, { speed: number; reaction: number; dodge: number; label: string }> = {
  1: { speed: 70, reaction: 1.6, dodge: 0.15, label: "EASY" },
  2: { speed: 110, reaction: 1.0, dodge: 0.4, label: "MODERATE" },
  3: { speed: 160, reaction: 0.55, dodge: 0.7, label: "HARD" },
};

function loadStats() {
  if (typeof window === "undefined") return { wins: 0, losses: 0, streak: 0, best: 0 };
  try {
    return JSON.parse(localStorage.getItem("mk9_stats") || "") || { wins: 0, losses: 0, streak: 0, best: 0 };
  } catch {
    return { wins: 0, losses: 0, streak: 0, best: 0 };
  }
}

export function Mk9Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastLmRef = useRef<LM>(null);

  const baselineRef = useRef<{
    hipY: number | null;
    centerX: number | null;
    shoulderY: number | null;
    pixelHeight: number | null; // shoulder-to-ankle proxy in normalized units
  }>({ hipY: null, centerX: null, shoulderY: null, pixelHeight: null });

  const playerRef = useRef<Fighter>({
    x: 220, y: 0, vy: 0, crouch: 0, kick: 0, kickHeight: 0, kickCooldown: 0,
    punch: 0, punchCooldown: 0, hp: MAX_HP, height: 180, color: COLORS[0], facing: 1,
  });
  const botRef = useRef<BotState>({
    x: 580, y: 0, vy: 0, crouch: 0, kick: 0, kickHeight: 0, kickCooldown: 0,
    punch: 0, punchCooldown: 0, hp: MAX_HP, height: 180, color: COLORS[1], facing: -1,
    attackTimer: 1.5, attacking: 0, attackKind: "kick", attackHeight: 0.5,
  });

  const [phase, setPhase] = useState<"select" | "fight" | "result">("select");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;

  const [playerColorIdx, setPlayerColorIdx] = useState(0);
  const [botColorIdx, setBotColorIdx] = useState(1);
  const playerColorIdxRef = useRef(playerColorIdx);
  const botColorIdxRef = useRef(botColorIdx);
  playerColorIdxRef.current = playerColorIdx;
  botColorIdxRef.current = botColorIdx;

  const [winner, setWinner] = useState<string | null>(null);
  const [stats, setStats] = useState(loadStats);
  const [, force] = useState(0);
  const lastScoreRef = useRef<number | null>(null);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);

  // selection timer (lean to a zone for X seconds to confirm)
  const selectHoldRef = useRef<{ zone: string | null; t: number }>({ zone: null, t: 0 });

  useEffect(() => {
    (window as unknown as { __mk9Update?: (lm: LM) => void }).__mk9Update = (lm) => {
      lastLmRef.current = lm;
    };
    return () => {
      delete (window as unknown as { __mk9Update?: unknown }).__mk9Update;
    };
  }, []);

  useEffect(() => {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const startFight = () => {
      const playerColor = COLORS[playerColorIdxRef.current];
      const botColor = COLORS[botColorIdxRef.current];
      const baseHeight = baselineRef.current.pixelHeight
        ? Math.max(120, Math.min(240, baselineRef.current.pixelHeight * 380))
        : 180;
      playerRef.current = {
        x: 220, y: 0, vy: 0, crouch: 0, kick: 0, kickHeight: 0, kickCooldown: 0,
        punch: 0, punchCooldown: 0, hp: MAX_HP, height: baseHeight, color: playerColor, facing: 1,
      };
      botRef.current = {
        x: 580, y: 0, vy: 0, crouch: 0, kick: 0, kickHeight: 0, kickCooldown: 0,
        punch: 0, punchCooldown: 0, hp: MAX_HP, height: baseHeight, color: botColor, facing: -1,
        attackTimer: 1.5, attacking: 0, attackKind: "kick", attackHeight: 0.5,
      };
      scoreRef.current = 0;
      setScore(0);
      setWinner(null);
      lastScoreRef.current = null;
      setPhase("fight");
    };

    const onResult = (won: boolean) => {
      setStats((prev) => {
        const next = {
          wins: prev.wins + (won ? 1 : 0),
          losses: prev.losses + (won ? 0 : 1),
          streak: won ? prev.streak + 1 : 0,
          best: Math.max(prev.best, won ? prev.streak + 1 : prev.streak),
        };
        try { localStorage.setItem("mk9_stats", JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const lm = lastLmRef.current;

      // Read pose into normalized signals
      let normCenterX: number | null = null;
      let normHipY: number | null = null;
      let normShoulderY: number | null = null;
      let normPixelHeight: number | null = null;
      let ankleLift = 0;
      let kneeY: number | null = null;
      let leftWristUp = false;
      let rightWristUp = false;

      if (lm && lm.length >= 29) {
        const lHip = lm[23], rHip = lm[24];
        const lKnee = lm[25], rKnee = lm[26];
        const lAnk = lm[27], rAnk = lm[28];
        const lSh = lm[11], rSh = lm[12];
        const lWr = lm[15], rWr = lm[16];

        normCenterX = (lSh.x + rSh.x) / 2;
        normHipY = (lHip.y + rHip.y) / 2;
        normShoulderY = (lSh.y + rSh.y) / 2;
        normPixelHeight = ((lAnk.y + rAnk.y) / 2) - normShoulderY;

        if (baselineRef.current.hipY === null) baselineRef.current.hipY = normHipY;
        if (baselineRef.current.centerX === null) baselineRef.current.centerX = normCenterX;
        if (baselineRef.current.shoulderY === null) baselineRef.current.shoulderY = normShoulderY;
        if (baselineRef.current.pixelHeight === null) baselineRef.current.pixelHeight = normPixelHeight;
        // slow drift
        baselineRef.current.hipY = baselineRef.current.hipY! * 0.995 + normHipY * 0.005;
        baselineRef.current.centerX = baselineRef.current.centerX! * 0.99 + normCenterX * 0.01;
        baselineRef.current.shoulderY = baselineRef.current.shoulderY! * 0.995 + normShoulderY * 0.005;
        baselineRef.current.pixelHeight = baselineRef.current.pixelHeight! * 0.99 + normPixelHeight * 0.01;

        const baseHip = baselineRef.current.hipY!;
        const ankleY = Math.min(lAnk.y, rAnk.y);
        ankleLift = baseHip - ankleY; // positive when foot raised
        kneeY = Math.min(lKnee.y, rKnee.y);
        leftWristUp = lWr.y < lSh.y - 0.05;
        rightWristUp = rWr.y < rSh.y - 0.05;
      }

      ctx.clearRect(0, 0, ARENA_W, ARENA_H);
      // bg
      const grad = ctx.createLinearGradient(0, 0, 0, ARENA_H);
      grad.addColorStop(0, "#0a0e1a");
      grad.addColorStop(1, "#1a0830");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
      // floor lines
      ctx.strokeStyle = "rgba(0,230,255,0.25)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        const y = GROUND_Y + i * 6;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke();
      }

      if (phaseRef.current === "select") {
        // Selection screen — lean LEFT for color, lean RIGHT for difficulty, raise BOTH hands to start
        const baseCx = baselineRef.current.centerX;
        let zone: string | null = null;
        if (baseCx !== null && normCenterX !== null) {
          const dx = normCenterX - baseCx;
          if (leftWristUp && rightWristUp) zone = "start";
          else if (dx < -0.08) zone = "color";
          else if (dx > 0.08) zone = "difficulty";
        }
        if (zone && selectHoldRef.current.zone === zone) {
          selectHoldRef.current.t += dt;
        } else {
          selectHoldRef.current = { zone, t: 0 };
        }
        const HOLD = 1.2;
        if (selectHoldRef.current.t >= HOLD && zone) {
          if (zone === "color") setPlayerColorIdx((i) => (i + 1) % COLORS.length);
          else if (zone === "difficulty") setDifficulty((d) => ((d % 3) + 1) as Difficulty);
          else if (zone === "start") startFight();
          selectHoldRef.current = { zone, t: -0.5 };
        }

        // draw select UI
        ctx.fillStyle = "#fff";
        ctx.font = "bold 28px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText("MK 9 — SELECT", ARENA_W / 2, 50);

        // left panel: color
        drawSelectPanel(ctx, 20, 90, 220, 280, "LEAN LEFT", "COLOR", zone === "color" ? selectHoldRef.current.t / HOLD : 0);
        ctx.fillStyle = COLORS[playerColorIdxRef.current];
        ctx.beginPath(); ctx.arc(130, 240, 38, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillText("YOUR COLOR", 130, 310);

        // center: instructions
        ctx.fillStyle = "#fff";
        ctx.font = "14px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText("Raise BOTH HANDS to START", ARENA_W / 2, 200);
        ctx.fillText("Hold each pose ~1.2s", ARENA_W / 2, 224);
        ctx.fillStyle = COLORS[botColorIdxRef.current];
        ctx.beginPath(); ctx.arc(ARENA_W / 2, 280, 24, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#aaa"; ctx.font = "11px ui-monospace, monospace";
        ctx.fillText("(opponent color)", ARENA_W / 2, 318);

        // right panel: difficulty
        drawSelectPanel(ctx, ARENA_W - 240, 90, 220, 280, "LEAN RIGHT", "DIFFICULTY", zone === "difficulty" ? selectHoldRef.current.t / HOLD : 0);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 56px ui-monospace, monospace";
        ctx.fillText(String(difficultyRef.current), ARENA_W - 130, 250);
        ctx.font = "13px ui-monospace, monospace";
        ctx.fillText(DIFF_CFG[difficultyRef.current].label, ARENA_W - 130, 282);

        // start hold
        if (zone === "start") {
          ctx.fillStyle = "rgba(0,230,255,0.2)";
          ctx.fillRect(0, ARENA_H - 40, ARENA_W * (selectHoldRef.current.t / HOLD), 40);
          ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 16px ui-monospace, monospace";
          ctx.fillText("STARTING…", ARENA_W / 2, ARENA_H - 12);
        }

        // stats
        ctx.fillStyle = "#aaa"; ctx.textAlign = "left"; ctx.font = "11px ui-monospace, monospace";
        ctx.fillText(`W ${stats.wins}  L ${stats.losses}  STREAK ${stats.streak}  BEST ${stats.best}`, 20, ARENA_H - 12);

        force((n) => (n + 1) % 1e6);
        raf = requestAnimationFrame(loop);
        return;
      }

      // FIGHT phase
      const p = playerRef.current;
      const b = botRef.current;
      const diff = DIFF_CFG[difficultyRef.current];

      // sync colors live
      p.color = COLORS[playerColorIdxRef.current];
      b.color = COLORS[botColorIdxRef.current];

      // facing
      p.facing = b.x > p.x ? 1 : -1;
      b.facing = p.x > b.x ? 1 : -1;

      // ----- read player pose -----
      if (lm && baselineRef.current.hipY !== null && normCenterX !== null && normHipY !== null) {
        const baseHip = baselineRef.current.hipY!;
        const baseCx = baselineRef.current.centerX!;

        // crouch — invincible while crouching deeply
        const crouchAmt = Math.max(0, Math.min(1, (normHipY - baseHip) / 0.1));
        p.crouch = p.crouch * 0.6 + crouchAmt * 0.4;

        // arena movement = camera view; map normalized position into arena
        const dx = normCenterX - baseCx;
        const targetX = ARENA_W / 2 + dx * ARENA_W * 1.6;
        p.x = p.x * 0.85 + Math.max(80, Math.min(ARENA_W - 80, targetX)) * 0.15;

        // depth via pixel height (closer = bigger)
        if (normPixelHeight && baselineRef.current.pixelHeight) {
          const ratio = normPixelHeight / baselineRef.current.pixelHeight;
          p.height = Math.max(120, Math.min(240, 180 * ratio));
          // bot matches player height for fair fight
          b.height = p.height;
        }

        // jump detection: rapid upward shoulder movement OR ankle high without crouch
        if (p.y >= 0 && p.crouch < 0.3 && baselineRef.current.shoulderY !== null) {
          const shoulderRise = baselineRef.current.shoulderY - (normShoulderY ?? 0);
          if (shoulderRise > 0.06) {
            p.vy = -360;
          }
        }

        // kick detection — height of kick determines hit zone
        if (ankleLift > 0.15 && p.kickCooldown <= 0 && p.kick <= 0) {
          // 0..1: leg/body/head based on how high the foot goes
          const h = Math.max(0, Math.min(1, (ankleLift - 0.15) / 0.35));
          p.kickHeight = h;
          p.kick = 1;
          p.kickCooldown = 0.55;
        }

        // punch — wrist raised above shoulder
        if ((leftWristUp || rightWristUp) && p.punchCooldown <= 0 && p.punch <= 0) {
          p.punch = 1;
          p.punchCooldown = 0.4;
        }
      }

      // physics
      p.vy += 900 * dt;
      p.y += p.vy * dt;
      if (p.y > 0) { p.y = 0; p.vy = 0; }
      const pInAir = p.y < -10;

      // animation decay
      if (p.kick > 0) p.kick = Math.max(0, p.kick - dt * 3);
      if (p.punch > 0) p.punch = Math.max(0, p.punch - dt * 5);
      if (p.kickCooldown > 0) p.kickCooldown -= dt;
      if (p.punchCooldown > 0) p.punchCooldown -= dt;

      // ----- player hits bot -----
      const dist = Math.abs(p.x - b.x);
      const botInvincible = b.crouch > 0.55;
      if (p.kick > 0.6 && dist < REACH && !botInvincible) {
        if (pInAir) {
          b.hp -= 50; // jump kick flat 50
          p.kick = 0;
          scoreRef.current += 100;
        } else {
          // zone damage
          const dmg = p.kickHeight > 0.66 ? 50 : p.kickHeight > 0.33 ? 40 : 35;
          b.hp -= dmg;
          p.kick = 0;
          scoreRef.current += dmg;
        }
      }
      if (p.punch > 0.6 && dist < REACH - 20 && !botInvincible) {
        b.hp -= 15;
        p.punch = 0;
        scoreRef.current += 15;
      }

      // ----- bot AI -----
      b.attackTimer -= dt;
      const desired = p.x + (b.x > p.x ? REACH - 20 : -(REACH - 20));
      b.x += Math.sign(desired - b.x) * diff.speed * dt;
      b.x = Math.max(80, Math.min(ARENA_W - 80, b.x));

      // bot may dodge incoming kicks (higher diff = more dodging)
      if ((p.kick > 0.5 || p.punch > 0.5) && dist < REACH && Math.random() < diff.dodge * dt * 6) {
        b.crouch = Math.min(1, b.crouch + 0.5);
      } else {
        b.crouch = Math.max(0, b.crouch - dt * 2);
      }

      if (b.attackTimer <= 0 && dist < REACH + 10 && b.attacking <= 0) {
        b.attacking = 1;
        b.attackKind = Math.random() < 0.7 ? "kick" : "punch";
        b.attackHeight = Math.random(); // 0..1 zone
        b.attackTimer = diff.reaction + Math.random() * 0.6;
      }
      if (b.attacking > 0) {
        const prev = b.attacking;
        b.attacking = Math.max(0, b.attacking - dt * 2.5);
        if (prev > 0.5 && b.attacking <= 0.5 && dist < REACH) {
          // dodge if crouching deeply
          if (p.crouch > 0.55) {
            // invincible
          } else {
            let dmg = 0;
            if (b.attackKind === "kick") {
              dmg = b.attackHeight > 0.66 ? 50 : b.attackHeight > 0.33 ? 40 : 35;
            } else {
              dmg = 15;
            }
            p.hp -= dmg;
          }
        }
      }

      p.hp = Math.max(0, p.hp);
      b.hp = Math.max(0, b.hp);

      // ----- render fighters & UI -----
      drawStickman(ctx, p.x, GROUND_Y + p.y, p.height, p.crouch, p.kick, p.kickHeight, p.punch, p.facing, p.color);
      drawStickman(ctx, b.x, GROUND_Y + b.y, b.height, b.crouch, b.attacking > 0 && b.attackKind === "kick" ? b.attacking : 0, b.attackHeight, b.attacking > 0 && b.attackKind === "punch" ? b.attacking : 0, b.facing, b.color);

      drawHpBar(ctx, 20, 20, p.hp, p.color, "YOU");
      drawHpBar(ctx, ARENA_W - 220, 20, b.hp, b.color, `BOT · LVL ${difficultyRef.current}`, true);

      // score
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`SCORE ${scoreRef.current}  ·  STREAK ${stats.streak}`, ARENA_W / 2, 30);

      setScore(scoreRef.current);

      if (phaseRef.current === "fight" && (p.hp <= 0 || b.hp <= 0)) {
        const won = b.hp <= 0;
        setWinner(won ? "YOU WIN" : "BOT WINS");
        if (lastScoreRef.current === null) {
          lastScoreRef.current = scoreRef.current;
          onResult(won);
        }
        setPhase("result");
      }

      if (phaseRef.current === "result" && winner) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, ARENA_H / 2 - 60, ARENA_W, 120);
        ctx.fillStyle = winner === "YOU WIN" ? "#00e6ff" : "#ff44cc";
        ctx.font = "bold 44px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(winner, ARENA_W / 2, ARENA_H / 2);
        ctx.fillStyle = "#fff";
        ctx.font = "13px ui-monospace, monospace";
        ctx.fillText("Click to return to select", ARENA_W / 2, ARENA_H / 2 + 28);
      }

      force((n) => (n + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onClick = () => {
      if (phaseRef.current === "result") {
        setWinner(null);
        setPhase("select");
        selectHoldRef.current = { zone: null, t: 0 };
      }
    };
    c.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      c.removeEventListener("click", onClick);
    };
  }, [winner, stats.streak]);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        width={ARENA_W}
        height={ARENA_H}
        className="w-full h-auto rounded-xl border border-border bg-black"
      />
      <div className="mt-2 font-mono text-[11px] text-muted-foreground leading-relaxed space-y-0.5">
        <div><span className="text-primary">SELECT</span> — lean LEFT (color) · lean RIGHT (level 1/2/3) · BOTH HANDS UP to start</div>
        <div><span className="text-primary">KICK</span> — leg low = −35 · body mid = −40 · head high = −50</div>
        <div><span className="text-primary">JUMP+KICK</span> — mid-air kick = −50 flat</div>
        <div><span className="text-primary">PUNCH</span> — raise an arm (−15, fast)</div>
        <div><span className="text-primary">DODGE</span> — crouch deep = invincible</div>
        <div><span className="text-primary">MOVE</span> — the camera IS the arena: walk L/R/closer/farther</div>
        <div>Score {score} · Wins {stats.wins} · Streak {stats.streak} · Best {stats.best}</div>
      </div>
    </div>
  );
}

function drawSelectPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hint: string, title: string, progress: number) {
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = progress > 0 ? "#00e6ff" : "rgba(255,255,255,0.15)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#aaa";
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(hint, x + w / 2, y + 20);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px ui-monospace, monospace";
  ctx.fillText(title, x + w / 2, y + 42);
  if (progress > 0) {
    ctx.fillStyle = "rgba(0,230,255,0.25)";
    ctx.fillRect(x, y + h - 6, w * Math.min(1, progress), 6);
  }
}

function drawStickman(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  height: number,
  crouch: number,
  kick: number,
  kickHeight: number,
  punch: number,
  facing: 1 | -1,
  color: string,
) {
  const h = height * (1 - crouch * 0.3);
  const headR = h * 0.09;
  const hipY = groundY - h * 0.45;
  const shoulderY = hipY - h * 0.32;
  const headY = shoulderY - headR * 2;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(3, h * 0.025);
  ctx.lineCap = "round";

  // head
  ctx.beginPath(); ctx.arc(x, headY, headR, 0, Math.PI * 2); ctx.stroke();
  // spine
  ctx.beginPath(); ctx.moveTo(x, shoulderY); ctx.lineTo(x, hipY); ctx.stroke();

  // arms
  const punchExt = punch;
  // front arm (punching)
  ctx.beginPath();
  ctx.moveTo(x, shoulderY + 4);
  ctx.lineTo(x + facing * (20 + punchExt * 30), shoulderY + 16 - punchExt * 10);
  ctx.lineTo(x + facing * (24 + punchExt * 70), shoulderY + 22 - punchExt * 20);
  ctx.stroke();
  if (punch > 0.5) {
    const fx = x + facing * (24 + punchExt * 70);
    const fy = shoulderY + 22 - punchExt * 20;
    ctx.beginPath(); ctx.arc(fx, fy, 5, 0, Math.PI * 2); ctx.fill();
  }
  // back arm
  ctx.beginPath();
  ctx.moveTo(x, shoulderY + 4);
  ctx.lineTo(x - facing * 18, shoulderY + 24);
  ctx.lineTo(x - facing * 24, shoulderY + 50);
  ctx.stroke();

  // legs
  // back leg
  ctx.beginPath();
  ctx.moveTo(x, hipY);
  ctx.lineTo(x - facing * 12, hipY + 30);
  ctx.lineTo(x - facing * 14, groundY);
  ctx.stroke();

  if (kick > 0.05) {
    // kick target Y based on kickHeight
    // 0=leg (low), 0.5=body (mid), 1=head (high)
    const targetY = hipY + 30 - kickHeight * 80;
    const reach = 60 + kick * 40;
    const kx = x + facing * reach;
    const ky = targetY;
    ctx.beginPath();
    ctx.moveTo(x, hipY);
    ctx.lineTo(x + facing * 18, (hipY + ky) / 2);
    ctx.lineTo(kx, ky);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(kx, ky, 6, 0, Math.PI * 2); ctx.fill();
    // small glow line indicating hit zone
    ctx.strokeStyle = color + "88";
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx + facing * 12, ky); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x, hipY);
    ctx.lineTo(x + facing * 12, hipY + 30);
    ctx.lineTo(x + facing * 14, groundY);
    ctx.stroke();
  }
}

function drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, hp: number, color: string, label: string, rightAlign = false) {
  const w = 200, h = 16;
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  const fillW = (hp / MAX_HP) * w;
  ctx.fillRect(rightAlign ? x + w - fillW : x, y, fillW, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.textAlign = rightAlign ? "right" : "left";
  ctx.fillText(`${label}  ${Math.ceil(hp)}/${MAX_HP}`, rightAlign ? x + w : x, y - 4);
}
