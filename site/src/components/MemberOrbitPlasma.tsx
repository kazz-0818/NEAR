import { useEffect, useRef, type RefObject } from "react";

interface MemberOrbitPlasmaProps {
  fieldRef: RefObject<HTMLDivElement | null>;
  centerRef: RefObject<HTMLElement | null>;
  agentButtonRefs: RefObject<(HTMLButtonElement | null)[]>;
  colors: readonly string[];
}

/** CORE 中心から各メンバーアイコンへ追従するプラズマビーム（SVG） */
export function MemberOrbitPlasma({
  fieldRef,
  centerRef,
  agentButtonRefs,
  colors,
}: MemberOrbitPlasmaProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let raf = 0;

    const update = () => {
      const field = fieldRef.current;
      const center = centerRef.current;
      if (field && center) {
        const fr = field.getBoundingClientRect();
        const cr = center.getBoundingClientRect();
        const cx = cr.left + cr.width / 2 - fr.left;
        const cy = cr.top + cr.height / 2 - fr.top;

        agentButtonRefs.current.forEach((btn, i) => {
          const group = svg.querySelector<SVGGElement>(`[data-plasma="${i}"]`);
          if (!btn || !group) return;
          const br = btn.getBoundingClientRect();
          const x2 = br.left + br.width / 2 - fr.left;
          const y2 = br.top + br.height / 2 - fr.top;

          const grad = svg.querySelector<SVGLinearGradientElement>(`#member-plasma-grad-${i}`);
          if (grad) {
            grad.setAttribute("x1", String(cx));
            grad.setAttribute("y1", String(cy));
            grad.setAttribute("x2", String(x2));
            grad.setAttribute("y2", String(y2));
          }

          group.querySelectorAll("line").forEach((line) => {
            line.setAttribute("x1", String(cx));
            line.setAttribute("y1", String(cy));
            line.setAttribute("x2", String(x2));
            line.setAttribute("y2", String(y2));
          });
        });
      }

      raf = requestAnimationFrame(update);
    };

    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [fieldRef, centerRef, agentButtonRefs]);

  return (
    <svg
      ref={svgRef}
      className="member-orbit-plasma pointer-events-none absolute inset-0 z-[2] h-full w-full overflow-visible"
      aria-hidden
    >
      <defs>
        <filter id="member-plasma-blur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {colors.map((color, i) => (
          <linearGradient
            key={i}
            id={`member-plasma-grad-${i}`}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.95" />
            <stop offset="35%" stopColor="#c4b5fd" stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} stopOpacity="0.9" />
          </linearGradient>
        ))}
      </defs>
      {colors.map((color, i) => (
        <g key={i} data-plasma={i}>
          <line
            className="member-orbit-plasma-line member-orbit-plasma-line--glow"
            stroke={color}
            strokeWidth={5}
            opacity={0.22}
            filter="url(#member-plasma-blur)"
            style={{ animationDelay: `${i * 0.4}s` }}
          />
          <line
            className="member-orbit-plasma-line member-orbit-plasma-line--core"
            stroke={`url(#member-plasma-grad-${i})`}
            strokeWidth={1.75}
            style={{ animationDelay: `${i * 0.4}s` }}
          />
        </g>
      ))}
    </svg>
  );
}
