import { useRef } from "react";
import type { PhaseItem } from "../types/showcase";
import { useRevealOnScroll } from "../hooks/useRevealOnScroll";

const STATUS_STYLE: Record<
  PhaseItem["status"],
  { dot: string; label: string; opacity: string; bar: string }
> = {
  done: {
    dot: "bg-emerald-400",
    label: "完了",
    opacity: "opacity-90",
    bar: "bg-emerald-400/60",
  },
  active: {
    dot: "bg-cyan-400",
    label: "進行中",
    opacity: "opacity-100",
    bar: "bg-cyan-400",
  },
  upcoming: {
    dot: "bg-slate-600",
    label: "予定",
    opacity: "opacity-55",
    bar: "bg-slate-700",
  },
};

interface PhaseRoadmapProps {
  phases: PhaseItem[];
}

export function PhaseRoadmap({ phases }: PhaseRoadmapProps) {
  const ref = useRef<HTMLElement>(null);
  useRevealOnScroll(ref);

  return (
    <section id="roadmap" ref={ref} className="reveal-root relative px-6 py-28 md:py-40">
      <div className="relative mx-auto max-w-3xl">
        <h2 className="scroll-reveal text-center font-display text-3xl font-bold text-white md:text-4xl">
          Phase Roadmap
        </h2>
        <p className="scroll-reveal mt-4 text-center text-sm text-slate-500" style={{ transitionDelay: "0.06s" }}>
          Veliora 組織 OS の拡張フェーズ
        </p>
        <ul className="mt-14 space-y-4">
          {phases.map((phase, i) => {
            const style = STATUS_STYLE[phase.status];
            return (
              <li
                key={phase.id}
                className={`phase-row scroll-reveal-x scroll-reveal-x-left glass-panel relative flex gap-4 overflow-hidden rounded-xl p-5 ${style.opacity} ${phase.status === "active" ? "active-phase border-cyan-500/20" : ""}`}
                style={{ transitionDelay: `${0.1 + i * 0.07}s` }}
              >
                <div
                  className="phase-bar-fill scroll-reveal-scale absolute bottom-0 left-0 h-0.5 w-full origin-left"
                  style={{ background: style.bar, transitionDelay: `${0.14 + i * 0.07}s` }}
                />
                <div className="flex flex-col items-center">
                  <span className="font-display text-lg font-bold text-slate-600">
                    {String(phase.id).padStart(2, "0")}
                  </span>
                  <span
                    className={`mt-2 h-2.5 w-2.5 rounded-full ${style.dot} ${phase.status === "active" ? "animate-pulse" : ""}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base text-white md:text-lg">{phase.title}</h3>
                    <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] tracking-wide text-slate-500 uppercase">
                      {style.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{phase.summary}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
