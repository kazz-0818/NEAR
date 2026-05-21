import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { ShowcaseAgent } from "../types/showcase";
import { AgentIcon } from "./AgentIcon";
import { agentSectionId, scrollToId } from "../lib/agents";
import { RING_ORDER } from "../lib/colors";
import { usePauseAnimationsOffscreen } from "../hooks/usePauseAnimationsOffscreen";
import { useReducedMotion } from "../hooks/useReducedMotion";

const ORBIT_RADIUS = 138;
const ORBIT_DURATION = 72;

interface MemberOrbitItemProps {
  agent: ShowcaseAgent;
  index: number;
  total: number;
}

function MemberOrbitItem({ agent, index, total }: MemberOrbitItemProps) {
  const angle = (index / total) * 360 - 90;

  return (
    <div
      className="member-orbit-slot absolute left-0 top-0"
      style={{ ["--angle" as string]: `${angle}deg` } as React.CSSProperties}
    >
      <button
        type="button"
        className="member-orbit-upright z-10 flex flex-col items-center transition-transform duration-300 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        onClick={() => scrollToId(agentSectionId(agent))}
      >
        <div
          className="relative flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-full border-2 bg-[#050508]/90 shadow-lg sm:h-[4.75rem] sm:w-[4.75rem] md:h-[5.25rem] md:w-[5.25rem]"
          style={{
            borderColor: agent.accent,
            boxShadow: `0 0 24px ${agent.accent}55`,
          }}
        >
          <AgentIcon
            agentId={agent.id}
            alt={agent.displayName}
            glow={agent.accent}
            className="h-[82%] w-[82%] rounded-full"
          />
        </div>
        <span
          className="mt-2 font-display text-[9px] tracking-[0.2em] uppercase sm:text-[10px]"
          style={{ color: agent.accent }}
        >
          {agent.code}
        </span>
      </button>
    </div>
  );
}

interface OlympicMemberRingsProps {
  agents: ShowcaseAgent[];
}

export function OlympicMemberRings({ agents }: OlympicMemberRingsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  usePauseAnimationsOffscreen(wrapRef);
  const reduced = useReducedMotion();
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const ordered = RING_ORDER.map((id) => byId[id]).filter(Boolean) as ShowcaseAgent[];

  useEffect(() => {
    if (reduced || !wrapRef.current) return;

    const ctx = gsap.context(() => {
      gsap.from(".member-orbit-upright", {
        scale: 0,
        opacity: 0,
        duration: 0.7,
        stagger: 0.08,
        ease: "back.out(1.6)",
        delay: 0.15,
      });
    }, wrapRef);

    return () => ctx.revert();
  }, [reduced]);

  if (reduced) {
    return (
      <div className="flex flex-wrap justify-center gap-4 py-4">
        {ordered.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => scrollToId(agentSectionId(agent))}
            className="flex flex-col items-center gap-1"
          >
            <AgentIcon
              agentId={agent.id}
              alt={agent.code}
              glow={agent.accent}
              className="h-14 w-14 rounded-full"
            />
            <span className="font-display text-[10px] uppercase" style={{ color: agent.accent }}>
              {agent.code}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="member-orbit-field relative mx-auto aspect-square w-full max-w-[20rem] sm:max-w-[24rem] md:max-w-[28rem]"
      aria-label="Veliora メンバー — クリックで詳細"
      style={
        {
          ["--dur" as string]: `${ORBIT_DURATION}s`,
          ["--r" as string]: `${ORBIT_RADIUS}px`,
        } as React.CSSProperties
      }
    >
      <div
        className="rainbow-ring pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[72%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20"
        style={{
          boxShadow: "inset 0 0 40px rgba(255,255,255,0.06)",
        }}
      />

      <div className="member-orbit-track absolute left-1/2 top-1/2">
        {ordered.map((agent, i) => (
          <MemberOrbitItem key={agent.id} agent={agent} index={i} total={ordered.length} />
        ))}
      </div>
    </div>
  );
}
