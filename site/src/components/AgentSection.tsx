import { lazy, Suspense, useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { ShowcaseAgent } from "../types/showcase";
import { OrbitingCapabilities } from "./OrbitingCapabilities";
import { EvolutionTimeline } from "./EvolutionTimeline";
import { agentSectionId } from "../lib/agents";
import { useInView3d } from "../hooks/useInView3d";
import { usePauseAnimationsOffscreen } from "../hooks/usePauseAnimationsOffscreen";
import { useReducedMotion } from "../hooks/useReducedMotion";

const AgentSpace3D = lazy(() =>
  import("./AgentSpace3D").then((m) => ({ default: m.AgentSpace3D })),
);

gsap.registerPlugin(ScrollTrigger);

interface AgentSectionProps {
  agent: ShowcaseAgent;
  index: number;
}

export function AgentSection({ agent, index }: AgentSectionProps) {
  const ref = useRef<HTMLElement>(null);
  usePauseAnimationsOffscreen(ref);
  const showSpace3d = useInView3d(ref);
  const reduced = useReducedMotion();
  const isEven = index % 2 === 0;

  useEffect(() => {
    if (reduced || !ref.current) return;

    const ctx = gsap.context(() => {
      gsap.from(ref.current!.querySelector(".agent-code-badge"), {
        scrollTrigger: { trigger: ref.current, start: "top 82%" },
        scaleX: 0,
        duration: 0.6,
        ease: "power4.out",
      });

      gsap.fromTo(
        ref.current!.querySelectorAll(".agent-reveal"),
        { y: 48, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.85,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: { trigger: ref.current, start: "top 78%" },
        },
      );

      gsap.fromTo(
        ref.current!.querySelector(".orbit-field"),
        { scale: 0.85, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: { trigger: ref.current, start: "top 72%" },
        },
      );

      gsap.fromTo(
        ref.current!.querySelectorAll(".evo-item"),
        { x: isEven ? -20 : 20, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 0.5,
          stagger: 0.1,
          ease: "power2.out",
          scrollTrigger: { trigger: ref.current, start: "top 55%" },
        },
      );
    }, ref);

    return () => ctx.revert();
  }, [reduced, agent.id, isEven]);

  return (
    <section
      id={agentSectionId(agent)}
      ref={ref}
      className="agent-section relative scroll-mt-[5.5rem] overflow-hidden px-5 py-20 sm:px-8 sm:py-28 lg:py-32"
    >
      <div className="agent-space-fallback pointer-events-none absolute inset-0 z-0" aria-hidden />
      {showSpace3d && (
        <Suspense fallback={null}>
          <AgentSpace3D accent={agent.accent} agentId={agent.id} />
        </Suspense>
      )}
      <div
        className="agent-bg-drift pointer-events-none absolute inset-0 z-[2]"
        style={{
          background: `radial-gradient(ellipse 55% 45% at ${isEven ? "15%" : "85%"} 40%, ${agent.accent}22, transparent 65%), radial-gradient(ellipse 90% 50% at 50% 100%, rgba(15,23,42,0.35), transparent 55%)`,
        }}
      />
      <div
        className="pointer-events-none absolute top-0 right-0 left-0 z-[2] h-px opacity-50"
        style={{
          background: `linear-gradient(90deg, transparent, ${agent.accent}55, transparent)`,
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl">
        <div
          className={`agent-section-head agent-reveal mb-8 lg:mb-10 ${isEven ? "" : "lg:text-right"}`}
        >
          <span
            className="agent-code-badge inline-block origin-left rounded px-3 py-1 font-display text-[10px] tracking-[0.35em] uppercase lg:origin-right"
            style={{ background: `${agent.accent}18`, color: agent.accent }}
          >
            {agent.code}
          </span>
          <p
            className="mt-3 font-display text-xs tracking-[0.3em] uppercase"
            style={{ color: agent.accent }}
          >
            {agent.department}
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold text-white md:text-4xl">
            {agent.displayName}
          </h2>
          <p className="mt-3 text-sm text-slate-400 md:text-base">{agent.role}</p>
        </div>

        <div className="agent-reveal grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:items-start">
          <div className={isEven ? "" : "lg:order-2"}>
            <h3
              className="mb-4 text-center font-display text-xs tracking-[0.25em] text-slate-500 uppercase lg:mb-6"
            >
              Capabilities — 軌道で稼働
            </h3>
            <OrbitingCapabilities agent={agent} />
            <p className="mx-auto mt-8 max-w-md text-center text-sm leading-relaxed text-slate-500">
              {agent.description}
            </p>
          </div>

          <div className={`agent-reveal ${isEven ? "" : "lg:order-1"}`}>
            <div className="glass-panel agent-panel-glow relative overflow-hidden rounded-2xl p-6 md:p-8">
              <div
                className="pointer-events-none absolute -top-16 -right-16 h-32 w-32 rounded-full blur-3xl"
                style={{ background: `${agent.accent}15` }}
              />
              <h3
                className="relative mb-6 font-display text-sm tracking-[0.25em] uppercase"
                style={{ color: agent.accent }}
              >
                Evolution Log
              </h3>
              <EvolutionTimeline entries={agent.evolutionLog} accent={agent.accent} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
