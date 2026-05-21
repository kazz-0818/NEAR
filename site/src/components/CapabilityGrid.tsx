import type { ShowcaseCapability } from "../types/showcase";

const STATUS_LABEL: Record<string, string> = {
  live: "稼働中",
  evolved: "進化",
  planned: "計画中",
};

interface CapabilityGridProps {
  capabilities: ShowcaseCapability[];
  accent: string;
}

export function CapabilityGrid({ capabilities, accent }: CapabilityGridProps) {
  return (
    <div className="cap-grid grid gap-3 sm:grid-cols-2">
      {capabilities.map((cap) => (
        <div
          key={cap.id}
          className="cap-card glass-panel group relative overflow-hidden rounded-xl p-4 transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1.5 hover:scale-[1.02]"
          style={{
            borderColor: cap.highlight ? `${accent}55` : undefined,
          }}
        >
          <div
            className="cap-shine pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            style={{
              background: `linear-gradient(105deg, transparent 40%, ${accent}12 50%, transparent 60%)`,
            }}
          />
          {cap.highlight && (
            <span
              className="absolute right-3 top-3 z-10 animate-pulse rounded px-2 py-0.5 font-display text-[10px] tracking-wider uppercase"
              style={{ background: `${accent}28`, color: accent }}
            >
              NEW
            </span>
          )}
          <p className="relative z-10 pr-12 text-sm leading-relaxed text-slate-200">{cap.label}</p>
          <div className="relative z-10 mt-3 flex items-center gap-2 text-[10px] tracking-wide uppercase">
            <span
              className="rounded px-2 py-0.5 font-display"
              style={{
                background:
                  cap.status === "planned"
                    ? "rgba(148,163,184,0.15)"
                    : `${accent}18`,
                color: cap.status === "planned" ? "#94a3b8" : accent,
              }}
            >
              {STATUS_LABEL[cap.status]}
            </span>
            {cap.since && <span className="text-slate-600">since {cap.since}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
