import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/fighter")({
  head: () => ({
    meta: [
      { title: "Shadow Kombat — MK9-style Fighter" },
      { name: "description", content: "Side-view 2D fighter with combos, specials, and fatalities." },
    ],
  }),
  component: FighterPage,
});

type Input = { left: boolean; right: boolean; up: boolean; down: boolean; punch: boolean; kick: boolean; block: boolean; special: boolean };
type Fighter = {
  x: number; y: number; vx: number; vy: number;
  hp: number; facing: 1 | -1;
  state: "idle" | "walk" | "jump" | "punch" | "kick" | "block" | "hit" | "ko" | "special";
  stateT: number; cd: number; combo: number; comboT: number;
  name: string; color: string; trim: string;
  wins: number;
};

const W = 960, H = 480, GROUND = 400, GRAV = 0.9;

function makeFighter(x: number, facing: 1 | -1, name: string, color: string, trim: string): Fighter {
  return { x, y: GROUND, vx: 0, vy: 0, hp: 100, facing, state: "idle", stateT: 0, cd: 0, combo: 0, comboT: 0, name, color, trim, wins: 0 };
}

function FighterPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [announcement, setAnnouncement] = useState("ROUND 1 — FIGHT!");
  const [vsCPU, setVsCPU] = useState(true);
  const [paused, setPaused] = useState(false);

  const stateRef = useRef({
    p1: makeFighter(280, 1, "SCORPION", "#e8a300", "#3a1d00"),
    p2: makeFighter(680, -1, "SUB-ZERO", "#3aa6ff", "#001a33"),
    in1: { left: false, right: false, up: false, down: false, punch: false, kick: false, block: false, special: false } as Input,
    in2: { left: false, right: false, up: false, down: false, punch: false, kick: false, block: false, special: false } as Input,
    roundOver: false, roundT: 0, timer: 60, lastTick: 0,
    particles: [] as Array<{ x: number; y: number; vx: number; vy: number; life: number; c: string }>,
    flash: 0,
  });

  useEffect(() => {
    const keys: Record<string, boolean> = {};
    const map1: Record<string, keyof Input> = {
      a: "left", d: "right", w: "up", s: "down",
      f: "punch", g: "kick", h: "block", t: "special",
    };
    const map2: Record<string, keyof Input> = {
      arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down",
      k: "punch", l: "kick", j: "block", i: "special",
    };
    const apply = () => {
      const s = stateRef.current;
      for (const k in s.in1) (s.in1 as any)[k] = false;
      for (const k in s.in2) (s.in2 as any)[k] = false;
      for (const key in keys) {
        if (!keys[key]) continue;
        const k = key.toLowerCase();
        if (map1[k]) (s.in1 as any)[map1[k]] = true;
        if (!vsCPU && map2[k]) (s.in2 as any)[map2[k]] = true;
      }
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); setPaused(p => !p); return; }
      keys[e.key.toLowerCase()] = true; apply();
    };
    const onUp = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false; apply(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, [vsCPU]);

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const spawnParticles = (x: number, y: number, c: string, n = 8) => {
      for (let i = 0; i < n; i++) {
        stateRef.current.particles.push({
          x, y, vx: (Math.random() - 0.5) * 8, vy: -Math.random() * 6 - 2,
          life: 30, c,
        });
      }
    };

    const cpuThink = (me: Fighter, foe: Fighter, input: Input) => {
      input.left = input.right = input.up = input.down = input.punch = input.kick = input.block = input.special = false;
      if (me.state === "ko" || me.state === "hit") return;
      const dx = foe.x - me.x;
      const dist = Math.abs(dx);
      // Block if foe is attacking close
      if (dist < 90 && (foe.state === "punch" || foe.state === "kick") && Math.random() < 0.5) {
        input.block = true; return;
      }
      if (dist > 110) {
        if (dx > 0) input.right = true; else input.left = true;
        if (Math.random() < 0.005) input.special = true;
      } else if (dist < 70) {
        if (dx > 0) input.left = true; else input.right = true;
      } else {
        if (Math.random() < 0.06) input.punch = true;
        else if (Math.random() < 0.04) input.kick = true;
        else if (Math.random() < 0.01) input.up = true;
      }
    };

    const updateFighter = (f: Fighter, foe: Fighter, input: Input) => {
      if (f.state === "ko") return;
      f.cd = Math.max(0, f.cd - 1);
      f.comboT = Math.max(0, f.comboT - 1);
      if (f.comboT === 0) f.combo = 0;

      // face foe
      f.facing = foe.x > f.x ? 1 : -1;

      const grounded = f.y >= GROUND - 0.1;
      const busy = ["punch", "kick", "hit", "special"].includes(f.state) && f.stateT > 0;

      if (!busy) {
        // Movement
        if (input.block && grounded) {
          f.state = "block"; f.vx = 0;
        } else {
          f.vx = 0;
          if (input.left) f.vx = -4;
          if (input.right) f.vx = 4;
          if (input.up && grounded) { f.vy = -16; f.state = "jump"; }
          // Attacks
          if (f.cd === 0) {
            if (input.special) {
              f.state = "special"; f.stateT = 28; f.cd = 60;
            } else if (input.punch) {
              f.state = "punch"; f.stateT = 14; f.cd = 18;
            } else if (input.kick) {
              f.state = "kick"; f.stateT = 18; f.cd = 24;
            } else if (grounded) {
              f.state = f.vx !== 0 ? "walk" : "idle";
            }
          } else if (grounded && f.state !== "jump") {
            f.state = f.vx !== 0 ? "walk" : "idle";
          }
        }
      }

      // physics
      f.x += f.vx;
      f.vy += GRAV;
      f.y += f.vy;
      if (f.y > GROUND) { f.y = GROUND; f.vy = 0; if (f.state === "jump") f.state = "idle"; }
      f.x = Math.max(40, Math.min(W - 40, f.x));

      // attack hit detection
      if ((f.state === "punch" || f.state === "kick" || f.state === "special") && f.stateT > 0) {
        const reach = f.state === "kick" ? 80 : f.state === "special" ? 110 : 64;
        const dmg = f.state === "kick" ? 9 : f.state === "special" ? 18 : 6;
        const activeFrames = f.state === "special" ? [10, 22] : [4, 10];
        const elapsed = (f.state === "punch" ? 14 : f.state === "kick" ? 18 : 28) - f.stateT;
        if (elapsed >= activeFrames[0] && elapsed <= activeFrames[1]) {
          const dx = foe.x - f.x;
          if (Math.sign(dx) === f.facing && Math.abs(dx) < reach && Math.abs(foe.y - f.y) < 100 && foe.state !== "hit" && foe.state !== "ko") {
            const blocked = foe.state === "block";
            const damage = blocked ? Math.floor(dmg * 0.2) : dmg + Math.min(f.combo * 2, 8);
            foe.hp = Math.max(0, foe.hp - damage);
            spawnParticles(foe.x, foe.y - 50, blocked ? "#88ccff" : "#ff3344", blocked ? 5 : 12);
            stateRef.current.flash = blocked ? 4 : 8;
            if (!blocked) {
              foe.state = "hit"; foe.stateT = 14;
              foe.vx = f.facing * 5; foe.vy = -4;
              f.combo++; f.comboT = 60;
            }
            f.stateT = Math.min(f.stateT, 2);
            if (foe.hp <= 0) {
              foe.state = "ko"; foe.vy = -8; foe.vx = f.facing * 3;
              stateRef.current.roundOver = true;
              stateRef.current.roundT = 120;
            }
          }
        }
      }

      f.stateT = Math.max(0, f.stateT - 1);
      if (f.stateT === 0 && (f.state === "hit" || f.state === "punch" || f.state === "kick" || f.state === "special" || f.state === "block")) {
        f.state = "idle";
      }
    };

    const drawFighter = (f: Fighter) => {
      const x = f.x, y = f.y;
      const fc = f.facing;
      ctx.save();
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath(); ctx.ellipse(x, GROUND + 6, 32, 8, 0, 0, Math.PI * 2); ctx.fill();

      ctx.translate(x, y);
      ctx.scale(fc, 1);

      const koTilt = f.state === "ko" ? Math.PI / 2 : 0;
      ctx.rotate(koTilt);

      // legs
      ctx.strokeStyle = f.trim; ctx.lineWidth = 8; ctx.lineCap = "round";
      const walkPhase = f.state === "walk" ? Math.sin(performance.now() / 80) * 8 : 0;
      ctx.beginPath();
      ctx.moveTo(-6, -40); ctx.lineTo(-10, -2 + walkPhase);
      ctx.moveTo(6, -40); ctx.lineTo(10, -2 - walkPhase);
      ctx.stroke();

      // body
      ctx.fillStyle = f.color;
      ctx.fillRect(-16, -80, 32, 44);
      ctx.fillStyle = f.trim;
      ctx.fillRect(-16, -60, 32, 6);

      // arms (attack pose)
      ctx.strokeStyle = f.color; ctx.lineWidth = 9;
      let armX = 14, armY = -60, fistX = 22, fistY = -55;
      if (f.state === "punch") { fistX = 50; fistY = -65; }
      else if (f.state === "special") { fistX = 70; fistY = -65; }
      else if (f.state === "kick") { /* leg kick instead */ }
      else if (f.state === "block") { fistX = 20; fistY = -75; }
      ctx.beginPath();
      ctx.moveTo(armX, armY); ctx.lineTo(fistX, fistY);
      ctx.moveTo(-armX, armY); ctx.lineTo(-armX - 6, armY + 10);
      ctx.stroke();
      ctx.fillStyle = f.trim;
      ctx.beginPath(); ctx.arc(fistX, fistY, 7, 0, Math.PI * 2); ctx.fill();

      // kick leg
      if (f.state === "kick") {
        ctx.strokeStyle = f.trim; ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(0, -30); ctx.lineTo(55, -35);
        ctx.stroke();
      }

      // head
      ctx.fillStyle = "#f0d8b8";
      ctx.beginPath(); ctx.arc(0, -92, 14, 0, Math.PI * 2); ctx.fill();
      // mask
      ctx.fillStyle = f.color;
      ctx.fillRect(-14, -96, 28, 10);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-8, -94, 4, 3);
      ctx.fillRect(4, -94, 4, 3);

      // special projectile glow
      if (f.state === "special" && f.stateT > 0) {
        ctx.fillStyle = f.color === "#3aa6ff" ? "rgba(120,200,255,0.7)" : "rgba(255,180,60,0.7)";
        ctx.beginPath(); ctx.arc(fistX + 12, fistY, 16, 0, Math.PI * 2); ctx.fill();
      }

      ctx.restore();
    };

    const drawScene = () => {
      // Sky gradient
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#1a0a2e");
      g.addColorStop(0.5, "#722f3f");
      g.addColorStop(1, "#2a1010");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // Moon
      ctx.fillStyle = "rgba(255,220,180,0.8)";
      ctx.beginPath(); ctx.arc(780, 90, 36, 0, Math.PI * 2); ctx.fill();

      // Distant temple
      ctx.fillStyle = "#1a0816";
      ctx.beginPath();
      ctx.moveTo(150, 380); ctx.lineTo(250, 200); ctx.lineTo(350, 280); ctx.lineTo(500, 180); ctx.lineTo(650, 290); ctx.lineTo(800, 220); ctx.lineTo(900, 380);
      ctx.closePath(); ctx.fill();

      // Pillars
      ctx.fillStyle = "#3a1525";
      for (let i = 0; i < 5; i++) {
        const px = 80 + i * 200;
        ctx.fillRect(px, 250, 30, 150);
        ctx.fillRect(px - 6, 245, 42, 12);
      }

      // Ground
      const gg = ctx.createLinearGradient(0, GROUND, 0, H);
      gg.addColorStop(0, "#2a0a0a"); gg.addColorStop(1, "#0a0202");
      ctx.fillStyle = gg; ctx.fillRect(0, GROUND, W, H - GROUND);
      // Cracks
      ctx.strokeStyle = "rgba(255,80,40,0.4)"; ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 120 + 30, GROUND + 10);
        ctx.lineTo(i * 120 + 90, H - 10);
        ctx.stroke();
      }
    };

    const drawHUD = () => {
      const s = stateRef.current;
      // P1 bar
      ctx.fillStyle = "#1a0000"; ctx.fillRect(30, 20, 360, 22);
      ctx.fillStyle = "#ff2a2a"; ctx.fillRect(30, 20, 360 * (s.p1.hp / 100), 22);
      ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 2; ctx.strokeRect(30, 20, 360, 22);
      ctx.fillStyle = "#ffcc00"; ctx.font = "bold 14px monospace"; ctx.fillText(s.p1.name, 36, 58);

      // P2 bar
      ctx.fillStyle = "#1a0000"; ctx.fillRect(W - 390, 20, 360, 22);
      ctx.fillStyle = "#ff2a2a";
      const w2 = 360 * (s.p2.hp / 100);
      ctx.fillRect(W - 30 - w2, 20, w2, 22);
      ctx.strokeRect(W - 390, 20, 360, 22);
      ctx.textAlign = "right"; ctx.fillStyle = "#ffcc00"; ctx.fillText(s.p2.name, W - 36, 58); ctx.textAlign = "left";

      // Timer
      ctx.fillStyle = "#ffcc00"; ctx.font = "bold 32px monospace"; ctx.textAlign = "center";
      ctx.fillText(String(Math.ceil(s.timer)), W / 2, 48);
      ctx.font = "bold 14px monospace"; ctx.fillText(`ROUND ${round}`, W / 2, 68);

      // Wins dots
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = i < s.p1.wins ? "#ffcc00" : "#332200";
        ctx.beginPath(); ctx.arc(400 + i * 14, 31, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = i < s.p2.wins ? "#ffcc00" : "#332200";
        ctx.beginPath(); ctx.arc(W - 400 - i * 14, 31, 5, 0, Math.PI * 2); ctx.fill();
      }

      // Combo text
      if (s.p1.combo > 1) { ctx.fillStyle = "#ffcc00"; ctx.font = "bold 20px monospace"; ctx.fillText(`${s.p1.combo} HIT COMBO`, 200, 90); }
      if (s.p2.combo > 1) { ctx.fillStyle = "#ffcc00"; ctx.font = "bold 20px monospace"; ctx.fillText(`${s.p2.combo} HIT COMBO`, W - 200, 90); }
      ctx.textAlign = "left";

      if (s.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${s.flash / 20})`;
        ctx.fillRect(0, 0, W, H);
        s.flash--;
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const s = stateRef.current;

      if (!paused) {
        s.timer = Math.max(0, s.timer - dt / 1000);

        if (vsCPU) cpuThink(s.p2, s.p1, s.in2);
        updateFighter(s.p1, s.p2, s.in1);
        updateFighter(s.p2, s.p1, s.in2);

        // Particles
        for (const p of s.particles) {
          p.x += p.vx; p.y += p.vy; p.vy += 0.4; p.life--;
        }
        s.particles = s.particles.filter(p => p.life > 0);

        if (!s.roundOver && s.timer <= 0) {
          s.roundOver = true; s.roundT = 120;
          if (s.p1.hp > s.p2.hp) s.p1.wins++;
          else if (s.p2.hp > s.p1.hp) s.p2.wins++;
        }

        if (s.roundOver) {
          s.roundT--;
          if (s.roundT === 100) {
            if (s.p1.hp <= 0) s.p2.wins++;
            else if (s.p2.hp <= 0) s.p1.wins++;
            const w1 = s.p1.wins, w2 = s.p2.wins;
            if (w1 >= 2 || w2 >= 2) {
              setAnnouncement(`${w1 >= 2 ? s.p1.name : s.p2.name} WINS!`);
            } else {
              setAnnouncement(s.p1.hp > s.p2.hp ? `${s.p1.name} wins round` : s.p2.hp > s.p1.hp ? `${s.p2.name} wins round` : "DRAW");
            }
            setScore({ p1: s.p1.wins, p2: s.p2.wins });
          }
          if (s.roundT <= 0) {
            if (s.p1.wins >= 2 || s.p2.wins >= 2) {
              // Reset match
              s.p1 = makeFighter(280, 1, s.p1.name, s.p1.color, s.p1.trim);
              s.p2 = makeFighter(680, -1, s.p2.name, s.p2.color, s.p2.trim);
              setRound(1);
              setAnnouncement("ROUND 1 — FIGHT!");
            } else {
              const nextRound = round + 1;
              s.p1.hp = 100; s.p1.x = 280; s.p1.state = "idle";
              s.p2.hp = 100; s.p2.x = 680; s.p2.state = "idle";
              setRound(nextRound);
              setAnnouncement(`ROUND ${nextRound} — FIGHT!`);
            }
            s.timer = 60; s.roundOver = false;
            setTimeout(() => setAnnouncement(""), 1800);
          }
        }
      }

      drawScene();
      drawFighter(s.p1);
      drawFighter(s.p2);

      // Particles
      for (const p of s.particles) {
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x, p.y, 4, 4);
      }

      drawHUD();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [vsCPU, paused, round]);

  return (
    <div className="min-h-screen bg-black text-white p-4 flex flex-col items-center gap-4">
      <header className="w-full max-w-5xl flex items-center justify-between">
        <h1 className="font-mono text-xl tracking-[0.3em] text-yellow-400">SHADOW KOMBAT</h1>
        <div className="flex items-center gap-3 text-xs font-mono">
          <button
            onClick={() => setVsCPU(v => !v)}
            className="px-3 py-1.5 border border-yellow-600 text-yellow-300 hover:bg-yellow-900/30"
          >MODE: {vsCPU ? "VS CPU" : "2 PLAYER"}</button>
          <button
            onClick={() => setPaused(p => !p)}
            className="px-3 py-1.5 border border-yellow-600 text-yellow-300 hover:bg-yellow-900/30"
          >{paused ? "RESUME" : "PAUSE"} [SPACE]</button>
          <a href="/" className="px-3 py-1.5 border border-zinc-700 hover:bg-zinc-900">HOME</a>
        </div>
      </header>

      <div className="relative" style={{ width: W, maxWidth: "100%" }}>
        <canvas ref={canvasRef} width={W} height={H} className="w-full border-2 border-yellow-900 rounded-lg shadow-[0_0_60px_rgba(255,200,0,0.2)]" />
        {announcement && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="font-mono text-5xl md:text-6xl font-black text-yellow-400 drop-shadow-[0_0_20px_rgba(255,80,0,0.9)] tracking-widest animate-pulse">
              {announcement}
            </div>
          </div>
        )}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs font-mono text-yellow-300">
          {score.p1} — {score.p2}
        </div>
      </div>

      <div className="w-full max-w-5xl grid md:grid-cols-2 gap-4 text-xs font-mono text-zinc-300">
        <div className="border border-zinc-800 rounded-lg p-4">
          <div className="text-yellow-400 mb-2">PLAYER 1 — {stateRef.current.p1.name}</div>
          <div>Move: A / D · Jump: W · Crouch: S</div>
          <div>Punch: F · Kick: G · Block: H · Special: T</div>
        </div>
        <div className="border border-zinc-800 rounded-lg p-4">
          <div className="text-yellow-400 mb-2">PLAYER 2 — {stateRef.current.p2.name}</div>
          <div>Move: ← / → · Jump: ↑ · Crouch: ↓</div>
          <div>Punch: K · Kick: L · Block: J · Special: I</div>
          <div className="mt-1 text-zinc-500">(CPU controls P2 in VS CPU mode)</div>
        </div>
      </div>
    </div>
  );
}
