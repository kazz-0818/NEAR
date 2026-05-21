import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { ShowcaseCapability } from "../types/showcase";
import { useReducedMotion } from "../hooks/useReducedMotion";

const STATUS_LABEL: Record<string, string> = {
  live: "稼働中",
  evolved: "進化",
  planned: "計画中",
};

interface CapabilityGridProps {
  capabilities: ShowcaseCapability[];
  accent: string;
}

export function CapabilityGrid({ capabilities, accent }: CapabilityGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !gridRef.current) return;

    const cards = gridRef.current.querySelectorAll<HTMLElement>(".cap-card");
    const handlers: Array<{ el: HTMLElement; enter: () => void; leave: () => void }> = [];

    cards.forEach((el) => {
      const enter = () => {
        gsap.to(el, {
          y: -6,
          scale: 1.02,
          boxShadow: `0 12px 40px ${accent}22`,
          duration: 0.35,
          ease: "power2.out",
        });
      };
      const leave = () => {
        gsap.to(el, {
          y: 0,
          scale: 1,
          boxShadow: "0 0 0 transparent",
          duration: 0.4,
          ease: "power2.out",
        });
      };
      el.addEventListener("mouseenter", enter);
      el.addEventListener("mouseleave", leave);
      handlers.push({ el, enter, leave });
    });

    return () => {
      handlers.forEach(({ el, enter, leave }) => {
        el.removeEventListener("mouseenter", enter);
        el.removeEventListener("mouseleave", leave);
      });
    };
  }, [reduced, accent, capabilities]);

  return (
    <div ref={gridRef} className="cap-grid grid gap-3 sm:grid-cols-2">
      {capabilities.map((cap) => (
        <div
          key={cap.id}
          className="cap-card glass-panel group relative overflow-hidden rounded-xl p-4"
          style={{
            borderColor: cap.highlight ? `${accent}55` : undefined,
          }}
        >
          <div
            className="cap-shine pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            style={{
              background: `linear-gradient(105deg, transparent 40%, ${accent}12 50%, transparent 60%)`,
            }}
          />
          {cap.highlight && (
            <span
              className="absolute right-3 top-3 z-10 animate-pulse rounded px-2 py-0.5 font-display text-[10px] tracking-wider uppercase"
              style={{ background: `${accent}28`, color: accent }}
            >
              NEW
            </span>
          )}
          <p className="relative z-10 pr-12 text-sm leading-relaxed text-slate-200">{cap.label}</p>
          <div className="relative z-10 mt-3 flex items-center gap-2 text-[10px] tracking-wide uppercase">
            <span
              className="rounded px-2 py-0.5 font-display"
              style={{
                background:
                  cap.status === "planned"
                    ? "rgba(148,163,184,0.15)"
                    : `${accent}18`,
                color: cap.status === "planned" ? "#94a3b8" : accent,
              }}
            >
              {STATUS_LABEL[cap.status]}
            </span>
            {cap.since && (
              <span className="text-slate-600">since {cap.since}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
