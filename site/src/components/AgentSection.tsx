import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { ShowcaseAgent } from "../types/showcase";
import { AgentIcon } from "./AgentIcon";
import { CapabilityGrid } from "./CapabilityGrid";
import { EvolutionTimeline } from "./EvolutionTimeline";
import { agentSectionId } from "../lib/agents";
import { useReducedMotion } from "../hooks/useReducedMotion";

gsap.registerPlugin(ScrollTrigger);

interface AgentSectionProps {
  agent: ShowcaseAgent;
  index: number;
}

export function AgentSection({ agent, index }: AgentSectionProps) {
  const ref = useRef<HTMLElement>(null);
  const iconWrapRef = useRef<HTMLDivElement>(null);
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

      gsap.from(ref.current!.querySelectorAll(".agent-reveal"), {
        scrollTrigger: { trigger: ref.current, start: "top 78%" },
        y: 56,
        opacity: 0,
        duration: 0.9,
        stagger: 0.12,
        ease: "power3.out",
      });

      gsap.from(ref.current!.querySelectorAll(".cap-card"), {
        scrollTrigger: { trigger: ref.current, start: "top 62%" },
        y: 32,
        opacity: 0,
        rotationX: -12,
        duration: 0.55,
        stagger: 0.06,
        ease: "power2.out",
      });

      gsap.from(ref.current!.querySelectorAll(".evo-item"), {
        scrollTrigger: { trigger: ref.current, start: "top 55%" },
        x: isEven ? -24 : 24,
        opacity: 0,
        duration: 0.5,
        stagger: 0.1,
        ease: "power2.out",
      });

      if (iconWrapRef.current) {
        gsap.to(iconWrapRef.current, {
          scrollTrigger: {
            trigger: ref.current,
            start: "top bottom",
            end: "bottom top",
            scrub: 1.2,
          },
          y: isEven ? -30 : 30,
          ease: "none",
        });
      }
    }, ref);

    return () => ctx.revert();
  }, [reduced, agent.id, isEven]);

  return (
    <section
      id={agentSectionId(agent)}
      ref={ref}
      className="agent-section relative scroll-mt-24 overflow-hidden px-5 py-20 sm:px-8 sm:py-28 lg:py-32"
    >
      <div
        className="agent-bg-drift pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 55% 45% at ${isEven ? "15%" : "85%"} 40%, ${agent.accent}18, transparent 65%)`,
        }}
      />
      <div
        className="pointer-events-none absolute top-0 right-0 left-0 h-px opacity-50"
        style={{
          background: `linear-gradient(90deg, transparent, ${agent.accent}55, transparent)`,
        }}
      />

      <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16">
        <div className={`agent-reveal flex flex-col gap-6 ${isEven ? "" : "lg:order-2"}`}>
          <div
            ref={iconWrapRef}
            className="agent-icon-orbit relative mx-auto w-fit md:mx-0"
          >
            <div
              className="absolute -inset-4 rounded-full opacity-60"
              style={{
                background: `conic-gradient(from 0deg, ${agent.accent}, transparent, ${agent.accent})`,
                animation: reduced ? undefined : "spin-slow 8s linear infinite",
              }}
            />
            <AgentIcon
              agentId={agent.id}
              alt={agent.displayName}
              glow={agent.accent}
              className="relative mx-auto h-44 w-44 md:h-56 md:w-56"
            />
          </div>
          <div>
            <span
              className="agent-code-badge inline-block origin-left rounded px-3 py-1 font-display text-[10px] tracking-[0.35em] uppercase"
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
          <p className="text-sm leading-relaxed text-slate-400 md:text-base">{agent.description}</p>
        </div>

        <div className={`space-y-10 ${isEven ? "" : "lg:order-1"}`}>
          <div className="agent-reveal">
            <h3
              className="mb-5 flex items-center gap-3 font-display text-sm tracking-[0.25em] uppercase"
              style={{ color: agent.accent }}
            >
              <span className="h-px flex-1 max-w-[3rem]" style={{ background: agent.accent }} />
              Capabilities
            </h3>
            <CapabilityGrid capabilities={agent.capabilities} accent={agent.accent} />
          </div>
          <div className="agent-reveal glass-panel agent-panel-glow relative overflow-hidden rounded-2xl p-6 md:p-8">
            <div
              className="pointer-events-none absolute -top-20 -right-20 h-40 w-40 rounded-full blur-3xl"
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
    </section>
  );
}
