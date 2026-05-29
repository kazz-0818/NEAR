import { useEffect, useRef, type RefObject } from "react";

interface MemberOrbitPlasmaProps {
  /** member-orbit-ring-wrap（SVG と同じ座標系） */
  ringRef: RefObject<HTMLDivElement | null>;
  originRef: RefObject<HTMLElement | null>;
  agentAvatarRefs: RefObject<(HTMLElement | null)[]>;
  colors: readonly string[];
}

function localCenter(el: HTMLElement, ring: DOMRect) {
  const r = el.getBoundingClientRect();
  return {
    x: r.left + r.width / 2 - ring.left,
    y: r.top + r.height / 2 - ring.top,
  };
}

/** CORE 中心から各メンバーアイコンへ追従するプラズマビーム（SVG） */
export function MemberOrbitPlasma({
  ringRef,
  originRef,
  agentAvatarRefs,
  colors,
}: MemberOrbitPlasmaProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const hubRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let raf = 0;
    const t0 = performance.now();

    const update = () => {
      const ring = ringRef.current;
      const origin = originRef.current;
      if (ring && origin) {
        const rr = ring.getBoundingClientRect();
        const { x: cx, y: cy } = localCenter(origin, rr);

        hubRef.current?.setAttribute("cx", String(cx));
        hubRef.current?.setAttribute("cy", String(cy));

        agentAvatarRefs.current.forEach((avatar, i) => {
          const group = svg.querySelector<SVGGElement>(`[data-plasma="${i}"]`);
          if (!avatar || !group) return;

          const { x: x2, y: y2 } = localCenter(avatar, rr);
          const mx = (cx + x2) / 2;
          const my = (cy + y2) / 2;
          const dx = x2 - cx;
          const dy = y2 - cy;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const wobble = Math.sin((performance.now() - t0) / 380 + i * 1.15) * 14;
          const qx = mx + nx * wobble;
          const qy = my + ny * wobble;
          const d = `M ${cx} ${cy} Q ${qx} ${qy} ${x2} ${y2}`;

          const grad = svg.querySelector<SVGLinearGradientElement>(`#member-plasma-grad-${i}`);
          if (grad) {
            grad.setAttribute("x1", String(cx));
            grad.setAttribute("y1", String(cy));
            grad.setAttribute("x2", String(x2));
            grad.setAttribute("y2", String(y2));
          }

          group.querySelectorAll("path").forEach((path) => {
            path.setAttribute("d", d);
          });
        });
      }

      raf = requestAnimationFrame(update);
    };

    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [ringRef, originRef, agentAvatarRefs]);

  return (
    <svg
      ref={svgRef}
      className="member-orbit-plasma pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
      aria-hidden
    >
      <defs>
        <filter id="member-plasma-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="member-plasma-displace" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018"
            numOctaves="2"
            seed={2}
            result="noise"
          >
            <animate
              attributeName="baseFrequency"
              values="0.012;0.028;0.012"
              dur="3.5s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" />
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
            filter="url(#member-plasma-blur)"
            style={{ animationDelay: `${i * 0.35}s` }}
          />
          <path
            className="member-orbit-plasma-path member-orbit-plasma-path--beam"
            stroke={`url(#member-plasma-grad-${i})`}
            strokeWidth={2.5}
            filter="url(#member-plasma-displace)"
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
