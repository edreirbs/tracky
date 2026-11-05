// Celebración (spec 003 § 5): confeti en canvas nativo, sin dependencias.
// Discreto en tareas chicas (como Foco Diario), a pantalla completa en M/L, "fiesta" en el sapo y logros.
// Respeta prefers-reduced-motion: sin partículas, solo un destello.

export type CelebrationLevel = "small" | "big" | "party";

const COLORS = ["#F3E3A1", "#F1D0C8", "#CFE2D0", "#C9DBEA", "#DDD4EB", "#F2D9B3", "#F2D45C"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  shape: "rect" | "streamer" | "coin";
  life: number;
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function flash(): void {
  const el = document.createElement("div");
  el.className = "celebrate-flash";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 600);
}

let active: { canvas: HTMLCanvasElement; particles: Particle[]; raf: number } | null = null;

function ensureCanvas(): NonNullable<typeof active> {
  if (active) return active;
  const canvas = document.createElement("canvas");
  canvas.className = "celebrate-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.getContext("2d")?.scale(dpr, dpr);
  active = { canvas, particles: [], raf: 0 };
  return active;
}

function spawn(cx: number, cy: number, count: number, spread: number, power: number, shapes: Particle["shape"][]): void {
  const a = ensureCanvas();
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const speed = power * (0.5 + Math.random() * 0.7);
    const shape = shapes[i % shapes.length]!;
    a.particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: shape === "streamer" ? 4 : shape === "coin" ? 12 : 8 + Math.random() * 5,
      h: shape === "streamer" ? 22 + Math.random() * 16 : shape === "coin" ? 12 : 5 + Math.random() * 4,
      color: shape === "coin" ? "#F2D45C" : COLORS[i % COLORS.length]!,
      shape,
      life: 1,
    });
  }
}

function loop(): void {
  const a = active;
  if (!a) return;
  const ctx = a.canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of a.particles) {
    p.vy += 0.32; // gravedad
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 0.0065;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === "coin") {
      ctx.beginPath();
      ctx.ellipse(0, 0, p.w / 2, (p.h / 2) * Math.abs(Math.cos(p.rot * 3)), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#C9A82A";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }
  a.particles = a.particles.filter((p) => p.life > 0 && p.y < innerHeight + 60);
  if (a.particles.length) {
    a.raf = requestAnimationFrame(loop);
  } else {
    a.canvas.remove();
    active = null;
  }
}

/** Lanza la celebración desde un elemento (o el centro) en < 100 ms. */
export function celebrate(level: CelebrationLevel, from?: Element | null): void {
  if (typeof document === "undefined") return;
  if (reducedMotion()) {
    flash();
    return;
  }
  const r = from?.getBoundingClientRect();
  const cx = r ? r.left + r.width / 2 : innerWidth / 2;
  const cy = r ? r.top + r.height / 2 : innerHeight / 2;
  const wasIdle = !active;
  if (level === "small") {
    spawn(cx, cy, 28, Math.PI * 1.1, 9, ["rect", "rect", "coin"]);
  } else if (level === "big") {
    spawn(cx, cy, 70, Math.PI * 1.4, 13, ["rect", "streamer", "coin"]);
    spawn(innerWidth * 0.15, innerHeight, 30, Math.PI / 3, 18, ["rect", "streamer"]);
    spawn(innerWidth * 0.85, innerHeight, 30, Math.PI / 3, 18, ["rect", "streamer"]);
  } else {
    for (let k = 0; k < 3; k++) {
      setTimeout(() => {
        spawn(innerWidth * (0.2 + 0.3 * k), innerHeight, 60, Math.PI / 2.5, 20, ["rect", "streamer", "streamer", "coin"]);
        if (!active?.raf) loop();
      }, k * 220);
    }
    spawn(cx, cy, 60, Math.PI * 2, 12, ["rect", "coin"]);
  }
  if (wasIdle) loop();
  if (navigator.vibrate) navigator.vibrate(level === "small" ? 15 : [20, 40, 30]);
}

/** Sonido opcional (apagado por defecto): un "ding" corto con Web Audio, sin archivos. */
export function ding(enabled: boolean, party = false): void {
  if (!enabled || typeof AudioContext === "undefined") return;
  const ctx = new AudioContext();
  const notes = party ? [660, 880, 1320] : [880, 1320];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    o.type = "triangle";
    g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.09);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.09 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.09 + 0.3);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + i * 0.09);
    o.stop(ctx.currentTime + i * 0.09 + 0.32);
  });
  setTimeout(() => void ctx.close(), 1200);
}

export function levelFor(size: string, isFrog: boolean): CelebrationLevel {
  if (isFrog) return "party";
  return size === "M" || size === "L" ? "big" : "small";
}
