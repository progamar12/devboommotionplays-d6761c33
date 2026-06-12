import { useEffect, useRef, useState } from "react";

type LM = Array<{ x: number; y: number; z: number; visibility?: number }> | null;

type PlayerState = {
  x: number; // arena position
  crouch: number; // 0..1
  kick: number; // 0..1 (animation progress)
  kickCooldown: number;
  hp: number;
};

type BotState = PlayerState & {
  attackTimer: number;
  attacking: number; // 0..1
  vx: number;
};

const ARENA_W = 800;
const ARENA_H = 420;
const GROUND_Y = 360;
const REACH = 90; // hit distance between fighters

export function Mk9Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PlayerState>({ x: 220, crouch: 0, kick: 0, kickCooldown: 0, hp: 100 });
  const botRef = useRef<BotState>({ x: 580, crouch: 0, kick: 0, kickCooldown: 0, hp: 100, attackTimer: 1.2, attacking: 0, vx: 0 });
  const baselineRef = useRef<{ hipY: number | null; centerX: number | null }>({ hipY: null, centerX: null });
  const lastLmRef = useRef<LM>(null);
  const [, force] = useState(0);
  const [winner, setWinner] = useState<string | null>(null);

  // receive landmarks from host pose pipeline
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

    const reset = () => {
      playerRef.current = { x: 220, crouch: 0, kick: 0, kickCooldown: 0, hp: 100 };
      botRef.current = { x: 580, crouch: 0, kick: 0, kickCooldown: 0, hp: 100, attackTimer: 1.2, attacking: 0, vx: 0 };
      setWinner(null);
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const p = playerRef.current;
      const b = botRef.current;
      const lm = lastLmRef.current;

      // --- read pose ---
      if (lm && lm.length >= 29) {
        const lHip = lm[23], rHip = lm[24];
        const lAnk = lm[27], rAnk = lm[28];
        const lSh = lm[11], rSh = lm[12];
        const hipY = (lHip.y + rHip.y) / 2;
        const centerX = (lSh.x + rSh.x) / 2;

        // calibrate baseline (first second of frames)
        if (baselineRef.current.hipY === null) baselineRef.current.hipY = hipY;
        if (baselineRef.current.centerX === null) baselineRef.current.centerX = centerX;
        // slow drift toward standing pose
        baselineRef.current.hipY = baselineRef.current.hipY * 0.995 + hipY * 0.005;

        const baseHip = baselineRef.current.hipY!;
        const baseCx = baselineRef.current.centerX!;

        // crouch: hips lower (y bigger) than baseline
        const crouchAmt = Math.max(0, Math.min(1, (hipY - baseHip) / 0.12));
        p.crouch = p.crouch * 0.6 + crouchAmt * 0.4;

        // forward/back: mirrored — moving right in image moves toward bot
        const dx = centerX - baseCx;
        p.x += dx * 220 * dt; // gentle drift
        p.x = Math.max(80, Math.min(ARENA_W - 80, p.x));

        // kick: ankle high (y small) relative to hip
        const ankleY = Math.min(lAnk.y, rAnk.y);
        const lift = baseHip - ankleY; // positive when foot raised
        if (lift > 0.18 && p.kickCooldown <= 0 && p.kick <= 0) {
          p.kick = 1;
          p.kickCooldown = 0.6;
        }
      }

      // --- player animations / cooldowns ---
      if (p.kick > 0) p.kick = Math.max(0, p.kick - dt * 3);
      if (p.kickCooldown > 0) p.kickCooldown -= dt;

      // --- collisions: player kick hits bot ---
      const dist = Math.abs(p.x - b.x);
      if (p.kick > 0.5 && dist < REACH && b.crouch < 0.6) {
        b.hp -= 35 * dt;
        b.vx -= 60 * dt;
      }

      // --- bot AI ---
      b.attackTimer -= dt;
      // chase: close distance to ~REACH-10
      const desired = p.x + (b.x > p.x ? REACH - 10 : -(REACH - 10));
      const move = Math.sign(desired - b.x) * 90 * dt;
      b.x += move + b.vx * dt;
      b.vx *= 0.9;
      b.x = Math.max(80, Math.min(ARENA_W - 80, b.x));

      if (b.attackTimer <= 0 && dist < REACH + 10 && b.attacking <= 0) {
        b.attacking = 1;
        b.attackTimer = 1.4 + Math.random() * 0.8;
      }
      if (b.attacking > 0) {
        const prev = b.attacking;
        b.attacking = Math.max(0, b.attacking - dt * 2.5);
        // damage tick at peak
        if (prev > 0.5 && b.attacking <= 0.5 && dist < REACH) {
          if (p.crouch > 0.5) {
            // dodged
          } else {
            p.hp -= 18;
          }
        }
      }

      p.hp = Math.max(0, p.hp);
      b.hp = Math.max(0, b.hp);
      if (!winner) {
        if (p.hp <= 0) setWinner("BOT WINS");
        else if (b.hp <= 0) setWinner("YOU WIN");
      }

      // --- render ---
      ctx.clearRect(0, 0, ARENA_W, ARENA_H);
      // bg
      const grad = ctx.createLinearGradient(0, 0, 0, ARENA_H);
      grad.addColorStop(0, "#0a0e1a");
      grad.addColorStop(1, "#1a0830");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);

      // floor grid
      ctx.strokeStyle = "rgba(0,230,255,0.25)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const y = GROUND_Y + i * 6;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke();
      }
      for (let i = 0; i <= 16; i++) {
        const x = (i / 16) * ARENA_W;
        ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo((x - ARENA_W / 2) * 2 + ARENA_W / 2, ARENA_H); ctx.stroke();
      }

      drawStickman(ctx, p.x, GROUND_Y, p.crouch, p.kick, b.x > p.x ? 1 : -1, "#00e6ff", 0);
      drawStickman(ctx, b.x, GROUND_Y, b.crouch, 0, p.x > b.x ? 1 : -1, "#ff44cc", b.attacking);

      // health bars
      drawHpBar(ctx, 20, 20, p.hp, "#00e6ff", "YOU");
      drawHpBar(ctx, ARENA_W - 220, 20, b.hp, "#ff44cc", "BOT", true);

      if (winner) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, ARENA_H / 2 - 50, ARENA_W, 100);
        ctx.fillStyle = winner === "YOU WIN" ? "#00e6ff" : "#ff44cc";
        ctx.font = "bold 48px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(winner, ARENA_W / 2, ARENA_H / 2 + 8);
        ctx.fillStyle = "#ffffff";
        ctx.font = "14px ui-monospace, monospace";
        ctx.fillText("Click to rematch", ARENA_W / 2, ARENA_H / 2 + 36);
      }

      force((n) => (n + 1) % 1000000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onClick = () => { if (winner) reset(); };
    c.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      c.removeEventListener("click", onClick);
    };
  }, [winner]);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        width={ARENA_W}
        height={ARENA_H}
        className="w-full h-auto rounded-xl border border-border bg-black"
      />
      <div className="mt-2 font-mono text-[11px] text-muted-foreground leading-relaxed">
        <div><span className="text-primary">KICK</span> — lift one foot up</div>
        <div><span className="text-primary">DODGE</span> — crouch down</div>
        <div><span className="text-primary">MOVE</span> — step left/right (mirrored)</div>
      </div>
    </div>
  );
}

function drawStickman(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  crouch: number,
  kick: number,
  facing: 1 | -1,
  color: string,
  attacking: number,
) {
  const height = 160 * (1 - crouch * 0.35);
  const headR = 14;
  const hipY = groundY - 60 * (1 - crouch * 0.4);
  const shoulderY = hipY - height * 0.4;
  const headY = shoulderY - 24;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";

  // head
  ctx.beginPath(); ctx.arc(x, headY, headR, 0, Math.PI * 2); ctx.stroke();

  // spine
  ctx.beginPath(); ctx.moveTo(x, shoulderY); ctx.lineTo(x, hipY); ctx.stroke();

  // arms
  const armSwing = attacking > 0 ? (1 - attacking) * 0.9 : 0;
  ctx.beginPath();
  ctx.moveTo(x, shoulderY + 4);
  ctx.lineTo(x + facing * (20 + armSwing * 40), shoulderY + 20);
  ctx.lineTo(x + facing * (10 + armSwing * 70), shoulderY + 40 - armSwing * 30);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, shoulderY + 4);
  ctx.lineTo(x - facing * 18, shoulderY + 24);
  ctx.lineTo(x - facing * 24, shoulderY + 50);
  ctx.stroke();

  // legs
  const kickAng = kick; // 0..1
  // back leg (standing)
  ctx.beginPath();
  ctx.moveTo(x, hipY);
  ctx.lineTo(x - facing * 12, hipY + 30);
  ctx.lineTo(x - facing * 14, groundY);
  ctx.stroke();
  // front leg (kicks)
  if (kickAng > 0.05) {
    const kx = x + facing * (40 + kickAng * 60);
    const ky = hipY + 10 - kickAng * 40;
    ctx.beginPath();
    ctx.moveTo(x, hipY);
    ctx.lineTo(x + facing * 20, hipY + 10 - kickAng * 20);
    ctx.lineTo(kx, ky);
    ctx.stroke();
    // foot flash
    ctx.beginPath(); ctx.arc(kx, ky, 6, 0, Math.PI * 2); ctx.fill();
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
  const fillW = (hp / 100) * w;
  ctx.fillRect(rightAlign ? x + w - fillW : x, y, fillW, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.textAlign = rightAlign ? "right" : "left";
  ctx.fillText(label, rightAlign ? x + w : x, y - 4);
}
