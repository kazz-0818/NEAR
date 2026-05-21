import type { ShowcaseAgent } from "../types/showcase";
import { AgentIcon } from "./AgentIcon";
import { agentSectionId, scrollToId } from "../lib/agents";
import { RING_ORDER } from "../lib/colors";

interface MemberHudProps {
  agents: ShowcaseAgent[];
}

export function MemberHud({ agents }: MemberHudProps) {
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  return (
    <div className="member-hud mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2 sm:gap-3">
      {RING_ORDER.map((id) => {
        const agent = byId[id];
        if (!agent) return null;
        return (
          <button
            key={id}
            type="button"
            onClick={() => scrollToId(agentSectionId(agent))}
            className="group flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur-md transition hover:border-white/25 hover:bg-white/5 sm:px-4 sm:py-2"
            style={
              {
                ["--accent" as string]: agent.accent,
              } as React.CSSProperties
            }
          >
            <AgentIcon
              agentId={agent.id}
              alt={agent.code}
              glow={agent.accent}
              className="h-8 w-8 shrink-0 rounded-full sm:h-9 sm:w-9"
            />
            <span
              className="font-display text-[10px] tracking-[0.15em] uppercase sm:text-xs"
              style={{ color: agent.accent }}
            >
              {agent.code}
            </span>
            <span className="hidden text-[10px] text-slate-500 sm:inline">
              {agent.department}
            </span>
          </button>
        );
      })}
    </div>
  );
}
