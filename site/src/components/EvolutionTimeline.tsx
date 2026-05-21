import type { EvolutionEntry } from "../types/showcase";

interface EvolutionTimelineProps {
  entries: EvolutionEntry[];
  accent: string;
  evoFromLeft?: boolean;
}

export function EvolutionTimeline({ entries, accent, evoFromLeft = true }: EvolutionTimelineProps) {
  return (
    <ol className="evo-list relative space-y-8 border-l border-white/10 pl-6">
      {entries.map((entry, i) => (
        <li
          key={`${entry.date}-${entry.title}`}
          className={`evo-item scroll-reveal-x relative ${evoFromLeft ? "scroll-reveal-x-left" : "scroll-reveal-x-right"}`}
          style={{ transitionDelay: `${0.12 + i * 0.08}s` }}
        >
          <span
            className="absolute -left-[1.65rem] top-1.5 h-3 w-3 rounded-full"
            style={{
              background: accent,
              boxShadow: `0 0 16px ${accent}, 0 0 32px ${accent}44`,
            }}
          />
          <time
            className="font-display text-[10px] tracking-[0.25em] uppercase"
            style={{ color: accent }}
          >
            {entry.date}
          </time>
          <h4 className="mt-1.5 text-base font-medium text-white md:text-lg">{entry.title}</h4>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{entry.summary}</p>
          {i === 0 && (
            <span
              className="evo-latest mt-3 inline-block rounded-full px-3 py-1 font-display text-[9px] tracking-widest uppercase"
              style={{ background: `${accent}15`, color: accent }}
            >
              Latest
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
