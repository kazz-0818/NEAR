import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { PhaseItem } from "../types/showcase";
import { useReducedMotion } from "../hooks/useReducedMotion";

gsap.registerPlugin(ScrollTrigger);

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
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !ref.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".roadmap-title", {
        scrollTrigger: { trigger: ref.current, start: "top 85%" },
        y: 50,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
      });

      gsap.from(".phase-row", {
        scrollTrigger: { trigger: ref.current, start: "top 78%" },
        x: -40,
        opacity: 0,
        duration: 0.65,
        stagger: 0.09,
        ease: "power3.out",
      });

      gsap.from(".phase-bar-fill", {
        scrollTrigger: { trigger: ref.current, start: "top 70%" },
        scaleX: 0,
        duration: 1,
        stagger: 0.08,
        ease: "power4.inOut",
      });

      ref.current!.querySelectorAll(".phase-row.active-phase").forEach((el) => {
        gsap.to(el, {
          boxShadow: "0 0 30px rgba(34,211,238,0.15)",
          duration: 2,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      });
    }, ref);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section id="roadmap" ref={ref} className="relative px-6 py-28 md:py-40">
      <div className="relative mx-auto max-w-3xl">
        <h2 className="roadmap-title text-center font-display text-3xl font-bold text-white md:text-4xl">
          Phase Roadmap
        </h2>
        <p className="roadmap-title mt-4 text-center text-sm text-slate-500">
          Veliora 組織 OS の拡張フェーズ
        </p>
        <ul className="mt-14 space-y-4">
          {phases.map((phase) => {
            const style = STATUS_STYLE[phase.status];
            return (
              <li
                key={phase.id}
                className={`phase-row glass-panel relative flex gap-4 overflow-hidden rounded-xl p-5 ${style.opacity} ${phase.status === "active" ? "active-phase border-cyan-500/20" : ""}`}
              >
                <div
                  className="phase-bar-fill absolute bottom-0 left-0 h-0.5 w-full origin-left"
                  style={{ background: style.bar }}
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
