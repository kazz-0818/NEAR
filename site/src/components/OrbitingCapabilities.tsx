import { useRef } from "react";
import type { ShowcaseAgent, ShowcaseCapability } from "../types/showcase";
import { AgentIcon } from "./AgentIcon";
import { usePauseAnimationsOffscreen } from "../hooks/usePauseAnimationsOffscreen";
import { useReducedMotion } from "../hooks/useReducedMotion";

const STATUS_LABEL: Record<string, string> = {
  live: "稼働中",
  evolved: "進化",
  planned: "計画中",
};

const ORBIT_DURATION_SEC = 88;
const ORBIT_RADIUS_PX = 158;

interface OrbitChipProps {
  cap: ShowcaseCapability;
  accent: string;
  index: number;
  total: number;
}

function OrbitChip({ cap, accent, index, total }: OrbitChipProps) {
  const angleDeg = (index / total) * 360 - 90;

  return (
    <div
      className="orbit-cap absolute left-1/2 top-1/2"
      style={
        {
          ["--start" as string]: `${angleDeg}deg`,
          ["--r" as string]: `${ORBIT_RADIUS_PX}px`,
          ["--dur" as string]: `${ORBIT_DURATION_SEC}s`,
        } as React.CSSProperties
      }
    >
      <div className="orbit-cap-inner w-max max-w-[11rem] sm:max-w-[12.5rem]">
        <div
          className="orbit-chip-panel rounded-lg border px-2.5 py-2 shadow-lg sm:px-3"
          style={{
            borderColor: cap.highlight ? `${accent}66` : "rgba(255,255,255,0.1)",
            boxShadow: cap.highlight ? `0 0 20px ${accent}33` : undefined,
            pointerEvents: "auto",
          }}
        >
          {cap.highlight && (
            <span
              className="mb-1 block font-display text-[8px] tracking-widest uppercase"
              style={{ color: accent }}
            >
              NEW
            </span>
          )}
          <p className="text-[10px] leading-snug text-slate-200 sm:text-[11px]">{cap.label}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[8px] uppercase sm:text-[9px]">
            <span
              className="rounded px-1.5 py-0.5 font-display"
              style={{
                background: cap.status === "planned" ? "rgba(148,163,184,0.12)" : `${accent}20`,
                color: cap.status === "planned" ? "#94a3b8" : accent,
              }}
            >
              {STATUS_LABEL[cap.status]}
            </span>
            {cap.since && <span className="text-slate-600">since {cap.since}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

interface OrbitingCapabilitiesProps {
  agent: ShowcaseAgent;
}

export function OrbitingCapabilities({ agent }: OrbitingCapabilitiesProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  usePauseAnimationsOffscreen(fieldRef);
  const reduced = useReducedMotion();
  const caps = agent.capabilities;

  if (reduced) {
    return (
      <div className="mx-auto w-full max-w-md">
        <div className="mx-auto mb-6 h-40 w-40">
          <AgentIcon
            agentId={agent.id}
            alt={agent.displayName}
            glow={agent.accent}
            className="h-full w-full rounded-full"
          />
        </div>
        <ul className="space-y-2 text-sm text-slate-400">
          {caps.map((cap) => (
            <li key={cap.id} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              {cap.label}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      ref={fieldRef}
      className="orbit-field relative mx-auto aspect-square w-full max-w-[min(100%,22rem)] sm:max-w-[26rem] md:max-w-[30rem]"
      aria-label={`${agent.code} の能力`}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[78%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed opacity-20"
        style={{ borderColor: agent.accent }}
      />

      {caps.map((cap, i) => (
        <OrbitChip key={cap.id} cap={cap} accent={agent.accent} index={i} total={caps.length} />
      ))}

      <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
        <div
          className="absolute -inset-3 rounded-full opacity-30"
          style={{
            border: `1px solid ${agent.accent}44`,
          }}
        />
        <AgentIcon
          agentId={agent.id}
          alt={agent.displayName}
          glow={agent.accent}
          className="relative h-28 w-28 rounded-full sm:h-32 sm:w-32 md:h-36 md:w-36"
        />
      </div>
    </div>
  );
}
