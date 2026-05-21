import type { ShowcaseAgent } from "../types/showcase";
import { agentSectionId, scrollToId } from "../lib/agents";
import { RING_ORDER } from "../lib/colors";

interface MemberHudProps {
  agents: ShowcaseAgent[];
}

/** 下部: テキストのみ（アイコンは OlympicMemberRings 側） */
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
            className="rounded-full border border-white/10 bg-black/40 px-3 py-1.5 font-display text-[10px] tracking-[0.12em] uppercase backdrop-blur-md transition hover:border-white/25 hover:bg-white/5 sm:px-4 sm:py-2"
          >
            <span style={{ color: agent.accent }}>{agent.code}</span>
            <span className="ml-1.5 text-slate-500">{agent.department}</span>
          </button>
        );
      })}
    </div>
  );
}
