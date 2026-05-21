import { useEffect, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { usePauseAnimationsOffscreen } from "../hooks/usePauseAnimationsOffscreen";

const ORBS = [
  { color: "#22d3ee", left: "8%", top: "18%", size: 320 },
  { color: "#e879f9", left: "72%", top: "12%", size: 280 },
  { color: "#fbbf24", left: "58%", top: "72%", size: 300 },
  { color: "#a78bfa", left: "12%", top: "62%", size: 240 },
  { color: "#fb7185", left: "88%", top: "48%", size: 200 },
];

interface Star {
  x: number;
  y: number;
  z: number;
  r: number;
  twinkle: number;
  phase: number;
}

function createStars(count: number, w: number, h: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    z: 0.2 + Math.random() * 0.8,
    r: 0.4 + Math.random() * 1.4,
    twinkle: 0.25 + Math.random() * 0.75,
    phase: Math.random() * Math.PI * 2,
  }));
}

function StarfieldCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let stars: Star[] = [];
    let raf = 0;
    let t0 = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const density = Math.min(520, Math.floor((w * h) / 2200));
      stars = createStars(density, w, h);
    };

    const draw = (now: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dt = Math.min((now - t0) / 1000, 0.05);
      t0 = now;

      ctx.clearRect(0, 0, w, h);

      for (const s of stars) {
        s.y += 6 * s.z * dt;
        if (s.y > h + 2) {
          s.y = -2;
          s.x = Math.random() * w;
        }
        const flicker = 0.55 + s.twinkle * (0.5 + 0.5 * Math.sin(now * 0.002 + s.phase));
        const alpha = flicker * (0.35 + s.z * 0.55);
        ctx.beginPath();
        ctx.fillStyle = `rgba(220, 235, 255, ${alpha})`;
        ctx.arc(s.x, s.y, s.r * (0.7 + s.z * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className="cosmic-starfield absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}

/** 全ページ共通の固定宇宙背景（ヒーロー・エージェント・ロードマップ全体） */
export function CosmicBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  usePauseAnimationsOffscreen(rootRef);
  const reduced = useReducedMotion();

  return (
    <div
      ref={rootRef}
      className="cosmic-space pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <div className="cosmic-space-base absolute inset-0" />
      <div className="cosmic-space-stars absolute inset-0" />
      <div className="cosmic-space-aurora absolute inset-0" />
      <div className="cosmic-space-grid absolute inset-0 opacity-[0.14]" />

      {!reduced &&
        ORBS.map((orb, i) => (
          <div
            key={i}
            className="ambient-orb absolute rounded-full blur-3xl"
            style={{
              left: orb.left,
              top: orb.top,
              width: orb.size,
              height: orb.size,
              background: `radial-gradient(circle, ${orb.color}28 0%, transparent 70%)`,
              animationDelay: `${i * 1.4}s`,
            }}
          />
        ))}

      {!reduced && <StarfieldCanvas active />}

      <div className="cosmic-space-vignette absolute inset-0" />
    </div>
  );
}
