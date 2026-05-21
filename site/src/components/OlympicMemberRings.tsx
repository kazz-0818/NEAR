import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { ShowcaseAgent } from "../types/showcase";
import { AgentIcon } from "./AgentIcon";
import { scrollToAgentSection } from "../lib/agents";
import { RING_ORDER } from "../lib/colors";
import { usePauseAnimationsOffscreen } from "../hooks/usePauseAnimationsOffscreen";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { useRingOrbitRadius } from "../hooks/useRingOrbitRadius";

const ORBIT_DURATION = 72;
const RING_SIZE_PERCENT = 72;

interface MemberOrbitItemProps {
  agent: ShowcaseAgent;
  index: number;
  total: number;
}

function MemberOrbitItem({ agent, index, total }: MemberOrbitItemProps) {
  const angle = (index / total) * 360 - 90;

  return (
    <div
      className="member-orbit-item absolute left-1/2 top-1/2"
      style={
        {
          ["--start" as string]: `${angle}deg`,
          ["--dur" as string]: `${ORBIT_DURATION}s`,
        } as React.CSSProperties
      }
    >
      <button
        type="button"
        className="member-orbit-btn z-10 flex flex-col items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        onClick={() => scrollToAgentSection(agent)}
      >
        <div
          className="member-orbit-avatar relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border-2 bg-[#050508]/90 shadow-lg sm:h-[5rem] sm:w-[5rem] md:h-[5.75rem] md:w-[5.75rem]"
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
          className="member-orbit-label mt-2 font-display text-[10px] tracking-[0.2em] uppercase sm:text-[11px]"
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
  const ringRef = useRef<HTMLDivElement>(null);
  const orbitRadiusPx = useRingOrbitRadius(ringRef);
  usePauseAnimationsOffscreen(wrapRef);
  const reduced = useReducedMotion();
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const ordered = RING_ORDER.map((id) => byId[id]).filter(Boolean) as ShowcaseAgent[];

  useEffect(() => {
    if (reduced || !wrapRef.current) return;

    const ctx = gsap.context(() => {
      gsap.from(".member-orbit-avatar", {
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
            onClick={() => scrollToAgentSection(agent)}
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
      className="member-orbit-field relative mx-auto aspect-square w-full max-w-[22rem] sm:max-w-[27rem] md:max-w-[32rem]"
      aria-label="Veliora メンバー — クリックで詳細"
    >
      <div
        ref={ringRef}
        className="member-orbit-ring-wrap"
        style={
          {
            width: `${RING_SIZE_PERCENT}%`,
            ["--orbit-r" as string]: `${orbitRadiusPx}px`,
            ["--dur" as string]: `${ORBIT_DURATION}s`,
          } as React.CSSProperties
        }
      >
        <div className="rainbow-ring pointer-events-none absolute inset-0 rounded-full" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 rounded-full opacity-20"
          style={{ boxShadow: "inset 0 0 40px rgba(255,255,255,0.06)" }}
        />
        {ordered.map((agent, i) => (
          <MemberOrbitItem key={agent.id} agent={agent} index={i} total={ordered.length} />
        ))}
      </div>
    </div>
  );
}
