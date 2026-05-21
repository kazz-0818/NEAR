import { useMemo, useRef } from "react";
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
const INNER_RING_MAX = 5;
const SINGLE_RING_MAX = 6;

const STATUS_ORDER: Record<string, number> = {
  evolved: 0,
  live: 1,
  planned: 2,
};

function sortForOrbit(caps: ShowcaseCapability[]) {
  return [...caps].sort((a, b) => {
    if (a.highlight !== b.highlight) return a.highlight ? -1 : 1;
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    return sa - sb;
  });
}

function splitOrbitRings(caps: ShowcaseCapability[]) {
  const sorted = sortForOrbit(caps);
  if (sorted.length <= SINGLE_RING_MAX) {
    return { mode: "single" as const, inner: [] as ShowcaseCapability[], outer: sorted };
  }
  return {
    mode: "dual" as const,
    inner: sorted.slice(0, INNER_RING_MAX),
    outer: sorted.slice(INNER_RING_MAX),
  };
}

function orbitLayout(count: number, mode: "single" | "dual") {
  const dense = count > 7;
  if (mode === "single") {
    return {
      innerR: 0,
      outerR: Math.min(188, 108 + count * 9),
      fieldClass:
        count > 5
          ? "max-w-[min(100%,24rem)] sm:max-w-[28rem] md:max-w-[32rem]"
          : "max-w-[min(100%,20rem)] sm:max-w-[24rem] md:max-w-[28rem]",
      dense,
    };
  }
  return {
    innerR: 118,
    outerR: Math.min(208, 168 + Math.max(0, count - INNER_RING_MAX) * 5),
    fieldClass: "max-w-[min(100%,26rem)] sm:max-w-[30rem] md:max-w-[34rem]",
    dense: true,
  };
}

interface OrbitChipProps {
  cap: ShowcaseCapability;
  accent: string;
  index: number;
  total: number;
  radiusPx: number;
  dense?: boolean;
}

function OrbitChip({ cap, accent, index, total, radiusPx, dense }: OrbitChipProps) {
  const angleDeg = (index / total) * 360 - 90;

  return (
    <div
      className="orbit-cap absolute left-1/2 top-1/2"
      style={
        {
          ["--start" as string]: `${angleDeg}deg`,
          ["--r" as string]: `${radiusPx}px`,
          ["--dur" as string]: `${ORBIT_DURATION_SEC}s`,
        } as React.CSSProperties
      }
    >
      <div
        className={`orbit-cap-inner w-max ${dense ? "max-w-[7.5rem] sm:max-w-[8rem]" : "max-w-[8.25rem] sm:max-w-[9rem]"}`}
      >
        <div
          className={`orbit-chip-panel rounded-md border shadow-lg ${dense ? "px-1.5 py-1" : "px-2 py-1 sm:px-2 sm:py-1.5"}`}
          style={{
            borderColor: cap.highlight ? `${accent}66` : "rgba(255,255,255,0.1)",
            boxShadow: cap.highlight ? `0 0 16px ${accent}28` : undefined,
            pointerEvents: "auto",
          }}
        >
          {cap.highlight && (
            <span
              className="mb-0.5 block font-display text-[6px] tracking-widest uppercase sm:text-[7px]"
              style={{ color: accent }}
            >
              NEW
            </span>
          )}
          <p
            className={`leading-snug text-slate-200 line-clamp-2 ${dense ? "text-[8px]" : "text-[8px] sm:text-[9px]"}`}
          >
            {cap.label}
          </p>
          <div
            className={`mt-0.5 flex flex-wrap items-center gap-1 uppercase ${dense ? "text-[6px]" : "text-[7px] sm:text-[8px]"}`}
          >
            <span
              className="rounded px-1 py-px font-display"
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

  const { mode, inner, outer } = useMemo(() => splitOrbitRings(caps), [caps]);
  const layout = useMemo(() => orbitLayout(caps.length, mode), [caps.length, mode]);

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

  const iconSize =
    caps.length > 7
      ? "h-[5.5rem] w-[5.5rem] sm:h-24 sm:w-24 md:h-28 md:w-28"
      : "h-24 w-24 sm:h-28 sm:w-28 md:h-32 md:w-32";

  return (
    <div className="w-full">
      <div
        ref={fieldRef}
        className={`orbit-field relative mx-auto aspect-square w-full ${layout.fieldClass}`}
        aria-label={`${agent.code} の能力`}
      >
        {mode === "dual" && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[52%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed opacity-15"
            style={{ borderColor: agent.accent }}
          />
        )}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed opacity-20"
          style={{
            borderColor: agent.accent,
            width: mode === "dual" ? "88%" : "78%",
            height: mode === "dual" ? "88%" : "78%",
          }}
        />

        {inner.map((cap, i) => (
          <OrbitChip
            key={cap.id}
            cap={cap}
            accent={agent.accent}
            index={i}
            total={inner.length}
            radiusPx={layout.innerR}
            dense={layout.dense}
          />
        ))}
        {outer.map((cap, i) => (
          <OrbitChip
            key={cap.id}
            cap={cap}
            accent={agent.accent}
            index={i}
            total={outer.length}
            radiusPx={layout.outerR}
            dense={layout.dense}
          />
        ))}

        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <div
            className="absolute -inset-2 rounded-full opacity-30"
            style={{ border: `1px solid ${agent.accent}44` }}
          />
          <AgentIcon
            agentId={agent.id}
            alt={agent.displayName}
            glow={agent.accent}
            className={`relative rounded-full ${iconSize}`}
          />
        </div>
      </div>
    </div>
  );
}
