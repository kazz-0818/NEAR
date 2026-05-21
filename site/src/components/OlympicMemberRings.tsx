import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { ShowcaseAgent } from "../types/showcase";
import { AgentIcon } from "./AgentIcon";
import { agentSectionId, scrollToId } from "../lib/agents";
import { useReducedMotion } from "../hooks/useReducedMotion";

/** オリンピック五輪配置: 上段3・下段2（重なり） */
const OLYMPIC_SLOTS: ReadonlyArray<{
  id: string;
  left: string;
  top: string;
  z: number;
  delay: number;
}> = [
  { id: "near", left: "4%", top: "2%", z: 2, delay: 0 },
  { id: "sera", left: "36%", top: "0%", z: 4, delay: 0.15 },
  { id: "lram", left: "68%", top: "2%", z: 3, delay: 0.3 },
  { id: "lira", left: "18%", top: "44%", z: 5, delay: 0.45 },
  { id: "rits", left: "50%", top: "44%", z: 6, delay: 0.6 },
];

interface OlympicMemberRingsProps {
  agents: ShowcaseAgent[];
}

export function OlympicMemberRings({ agents }: OlympicMemberRingsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  useEffect(() => {
    if (reduced || !wrapRef.current) return;

    const ctx = gsap.context(() => {
      gsap.from(".olympic-ring-btn", {
        scale: 0,
        opacity: 0,
        duration: 0.75,
        stagger: 0.1,
        ease: "back.out(1.8)",
        delay: 0.2,
      });
    }, wrapRef);

    return () => ctx.revert();
  }, [reduced]);

  return (
    <div
      ref={wrapRef}
      className="olympic-rings relative mx-auto h-[11.5rem] w-full max-w-[22rem] sm:h-[13rem] sm:max-w-[26rem] md:h-[15rem] md:max-w-[30rem]"
      aria-label="Veriora メンバー — クリックで詳細"
    >
      {/* 装飾用の薄いリング（アイコン背面） */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
        viewBox="0 0 300 160"
        aria-hidden
      >
        <circle cx="55" cy="52" r="42" fill="none" stroke="#f472b6" strokeWidth="2" />
        <circle cx="150" cy="48" r="42" fill="none" stroke="#facc15" strokeWidth="2" />
        <circle cx="245" cy="52" r="42" fill="none" stroke="#f97316" strokeWidth="2" />
        <circle cx="100" cy="108" r="42" fill="none" stroke="#c4b5fd" strokeWidth="2" />
        <circle cx="195" cy="108" r="42" fill="none" stroke="#22c55e" strokeWidth="2" />
      </svg>

      {OLYMPIC_SLOTS.map((slot) => {
        const agent = byId[slot.id];
        if (!agent) return null;

        return (
          <button
            key={slot.id}
            type="button"
            className="olympic-ring-btn olympic-float group absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            style={{
              left: slot.left,
              top: slot.top,
              zIndex: slot.z,
              animationDelay: `${slot.delay}s`,
            }}
            onClick={() => scrollToId(agentSectionId(agent))}
          >
            <div
              className="relative flex h-[4.75rem] w-[4.75rem] flex-col items-center justify-center rounded-full border-[3px] bg-[#050508]/80 shadow-lg backdrop-blur-sm transition duration-300 group-hover:scale-110 sm:h-[5.5rem] sm:w-[5.5rem] md:h-[6.25rem] md:w-[6.25rem]"
              style={{
                borderColor: agent.accent,
                boxShadow: `0 0 28px ${agent.accent}44, inset 0 0 20px ${agent.accent}11`,
              }}
            >
              <AgentIcon
                agentId={agent.id}
                alt={agent.displayName}
                glow={agent.accent}
                className="h-[78%] w-[78%] rounded-full"
              />
            </div>
            <span
              className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-display text-[9px] tracking-[0.2em] uppercase sm:text-[10px]"
              style={{ color: agent.accent }}
            >
              {agent.code}
            </span>
          </button>
        );
      })}
    </div>
  );
}
