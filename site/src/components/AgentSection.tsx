import { useRef } from "react";
import type { ShowcaseAgent } from "../types/showcase";
import { OrbitingCapabilities } from "./OrbitingCapabilities";
import { EvolutionTimeline } from "./EvolutionTimeline";
import { agentSectionId } from "../lib/agents";
import { usePauseAnimationsOffscreen } from "../hooks/usePauseAnimationsOffscreen";
import { useRevealOnScroll } from "../hooks/useRevealOnScroll";

interface AgentSectionProps {
  agent: ShowcaseAgent;
  index: number;
}

export function AgentSection({ agent, index }: AgentSectionProps) {
  const ref = useRef<HTMLElement>(null);
  usePauseAnimationsOffscreen(ref);
  useRevealOnScroll(ref);
  const isEven = index % 2 === 0;

  return (
    <section
      id={agentSectionId(agent)}
      ref={ref}
      className="agent-section reveal-root relative scroll-mt-[5.5rem] overflow-hidden px-5 py-20 sm:px-8 sm:py-28 lg:py-32"
    >
      <div
        className="agent-bg-drift pointer-events-none absolute inset-0 z-[1]"
        style={{
          background: `radial-gradient(ellipse 50% 40% at ${isEven ? "12%" : "88%"} 38%, ${agent.accent}14, transparent 70%)`,
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
          className={`agent-section-head scroll-reveal mb-8 lg:mb-10 ${isEven ? "" : "lg:text-right"}`}
        >
          <span
            className="agent-code-badge scroll-reveal-scale inline-block origin-left rounded px-3 py-1 font-display text-[10px] tracking-[0.35em] uppercase lg:origin-right"
            style={{ background: `${agent.accent}18`, color: agent.accent }}
          >
            {agent.code}
          </span>
          <p
            className="scroll-reveal mt-3 font-display text-xs tracking-[0.3em] uppercase"
            style={{ color: agent.accent, transitionDelay: "0.06s" }}
          >
            {agent.department}
          </p>
          <h2 className="scroll-reveal mt-2 font-display text-2xl font-bold text-white md:text-4xl" style={{ transitionDelay: "0.1s" }}>
            {agent.displayName}
          </h2>
          <p className="scroll-reveal mt-3 text-sm text-slate-400 md:text-base" style={{ transitionDelay: "0.14s" }}>
            {agent.role}
          </p>
        </div>

        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:items-start">
          <div className={`scroll-reveal ${isEven ? "" : "lg:order-2"}`} style={{ transitionDelay: "0.08s" }}>
            <h3
              className="mb-4 text-center font-display text-xs tracking-[0.25em] text-slate-500 uppercase lg:mb-6"
            >
              Capabilities
            </h3>
            <div className="scroll-reveal-zoom">
              <OrbitingCapabilities agent={agent} />
            </div>
            <p className="mx-auto mt-8 max-w-md text-center text-sm leading-relaxed text-slate-500">
              {agent.description}
            </p>
          </div>

          <div className={`scroll-reveal ${isEven ? "" : "lg:order-1"}`} style={{ transitionDelay: "0.16s" }}>
            <div className="glass-panel agent-panel-glow relative overflow-hidden rounded-2xl p-6 md:p-8">
              <div
                className="pointer-events-none absolute -top-16 -right-16 h-32 w-32 rounded-full blur-2xl"
                style={{ background: `${agent.accent}15` }}
              />
              <h3
                className="relative mb-6 font-display text-sm tracking-[0.25em] uppercase"
                style={{ color: agent.accent }}
              >
                Evolution Log
              </h3>
              <EvolutionTimeline entries={agent.evolutionLog} accent={agent.accent} evoFromLeft={isEven} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
