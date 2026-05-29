import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const FRAME_MS = 32; // ~30fps（見た目はほぼ同じ、CPU/GPU 負荷を抑える）

interface MemberOrbitPlasmaProps {
  ringRef: RefObject<HTMLDivElement | null>;
  orbitRadiusPx: number;
  /** 各メンバーの --start（deg） */
  agentStartsDeg: readonly number[];
  orbitDurationSec: number;
  colors: readonly string[];
}

function isPlasmaPaused(ring: HTMLElement | null): boolean {
  if (!ring) return true;
  if (document.hidden) return true;
  let el: HTMLElement | null = ring;
  while (el) {
    if (el.classList.contains("animations-paused")) return true;
    el = el.parentElement;
  }
  return false;
}

/** CORE 中心から各メンバーアイコンへ追従するプラズマビーム（SVG） */
export function MemberOrbitPlasma({
  ringRef,
  orbitRadiusPx,
  agentStartsDeg,
  orbitDurationSec,
  colors,
}: MemberOrbitPlasmaProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const hubRef = useRef<SVGCircleElement>(null);
  const pathsRef = useRef<(SVGPathElement | null)[][]>([]);
  const gradsRef = useRef<(SVGLinearGradientElement | null)[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    pathsRef.current = colors.map((_, i) => {
      const g = svg.querySelector<SVGGElement>(`[data-plasma="${i}"]`);
      if (!g) return [];
      return Array.from(g.querySelectorAll<SVGPathElement>("path"));
    });
    gradsRef.current = colors.map(
      (_, i) => svg.querySelector<SVGLinearGradientElement>(`#member-plasma-grad-${i}`),
    );
  }, [colors]);

  useEffect(() => {
    const ring = ringRef.current;
    const svg = svgRef.current;
    if (!ring || !svg) return;

    const measure = () => {
      const rr = ring.getBoundingClientRect();
      sizeRef.current = { w: rr.width, h: rr.height };
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ring);

    let raf = 0;
    let last = 0;
    const t0 = performance.now();

    const update = (now: number) => {
      raf = requestAnimationFrame(update);

      if (isPlasmaPaused(ring)) return;
      if (now - last < FRAME_MS) return;
      last = now;

      const { w, h } = sizeRef.current;
      if (w < 1 || h < 1) return;

      const cx = w / 2;
      const cy = h / 2;
      const r = orbitRadiusPx;
      const elapsed = (now - t0) / 1000;
      const spin = (elapsed / orbitDurationSec) * 360;
      const wobbleT = now / 380;

      hubRef.current?.setAttribute("cx", String(cx));
      hubRef.current?.setAttribute("cy", String(cy));

      agentStartsDeg.forEach((startDeg, i) => {
        const paths = pathsRef.current[i];
        const grad = gradsRef.current[i];
        if (!paths?.length) return;

        const deg = startDeg + spin;
        const rad = (deg * Math.PI) / 180;
        const x2 = cx + r * Math.cos(rad);
        const y2 = cy + r * Math.sin(rad);

        const mx = (cx + x2) / 2;
        const my = (cy + y2) / 2;
        const dx = x2 - cx;
        const dy = y2 - cy;
        const len = Math.hypot(dx, dy) || 1;
        const wobble = Math.sin(wobbleT + i * 1.15) * 14;
        const qx = mx + (-dy / len) * wobble;
        const qy = my + (dx / len) * wobble;
        const d = `M ${cx} ${cy} Q ${qx} ${qy} ${x2} ${y2}`;

        if (grad) {
          grad.setAttribute("x1", String(cx));
          grad.setAttribute("y1", String(cy));
          grad.setAttribute("x2", String(x2));
          grad.setAttribute("y2", String(y2));
        }

        for (const path of paths) {
          path?.setAttribute("d", d);
        }
      });
    };

    raf = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ringRef, orbitRadiusPx, agentStartsDeg, orbitDurationSec]);

  return (
    <svg
      ref={svgRef}
      className="member-orbit-plasma pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
      aria-hidden
    >
      <defs>
        <filter id="member-plasma-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <radialGradient id="member-plasma-hub-grad">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#c4b5fd" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
        {colors.map((color, i) => (
          <linearGradient key={i} id={`member-plasma-grad-${i}`} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="25%" stopColor="#e9d5ff" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#c4b5fd" stopOpacity="0.75" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
        ))}
      </defs>

      <circle ref={hubRef} r="38" fill="url(#member-plasma-hub-grad)" className="member-orbit-plasma-hub" />

      {colors.map((color, i) => (
        <g key={i} data-plasma={i}>
          <path
            className="member-orbit-plasma-path member-orbit-plasma-path--halo"
            stroke={color}
            strokeWidth={14}
            opacity={0.14}
            filter="url(#member-plasma-blur)"
            style={{ animationDelay: `${i * 0.35}s` }}
          />
          <path
            className="member-orbit-plasma-path member-orbit-plasma-path--glow"
            stroke={color}
            strokeWidth={6}
            opacity={0.38}
            style={{ animationDelay: `${i * 0.35}s` }}
          />
          <path
            className="member-orbit-plasma-path member-orbit-plasma-path--beam"
            stroke={`url(#member-plasma-grad-${i})`}
            strokeWidth={2.5}
            style={{ animationDelay: `${i * 0.35}s` }}
          />
          <path
            className="member-orbit-plasma-path member-orbit-plasma-path--spark"
            stroke="#ffffff"
            strokeWidth={1}
            opacity={0.85}
            style={{ animationDelay: `${i * 0.35 + 0.15}s`, animationDirection: "reverse" }}
          />
        </g>
      ))}
    </svg>
  );
}
