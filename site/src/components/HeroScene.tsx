import type { ShowcaseAgent } from "../types/showcase";
import { MemberHud } from "./MemberHud";
import { OlympicMemberRings } from "./OlympicMemberRings";

interface HeroSceneProps {
  title: string;
  tagline: string;
  subtitle: string;
  agents: ShowcaseAgent[];
}

export function HeroScene({ title, tagline, subtitle, agents }: HeroSceneProps) {
  return (
    <section
      id="hero"
      className="relative flex min-h-[100svh] flex-col overflow-hidden"
    >
      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-5xl flex-col px-5 pt-[5.5rem] pb-10 sm:px-8 lg:max-w-6xl lg:px-10">
        <header className="shrink-0 text-center">
          <p className="hero-chip mb-2 font-display text-[10px] tracking-[0.45em] text-slate-400 uppercase sm:text-xs">
            Organization OS
          </p>
          <h1
            className="hero-title font-display text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl"
            style={{ textShadow: "0 0 48px rgba(255,255,255,0.12)" }}
          >
            {title}
          </h1>
          <p className="hero-tag mt-3 font-display text-xs tracking-[0.18em] text-slate-400 sm:text-sm lg:text-base">
            {tagline}
          </p>
        </header>

        <div className="hero-stage relative flex min-h-0 flex-1 flex-col items-center justify-center py-6 sm:py-10">
          <OlympicMemberRings agents={agents} />
        </div>

        <footer className="hero-footer shrink-0 space-y-5 border-t border-white/5 pt-6 sm:pt-8">
          <MemberHud agents={agents} />
          <p className="hero-sub mx-auto max-w-lg text-center text-xs leading-relaxed text-slate-500 sm:text-sm">
            {subtitle}
          </p>
          <div className="flex justify-center">
            <a
              href="#units"
              className="hero-cta group inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-6 py-2.5 font-display text-[10px] tracking-[0.22em] text-slate-300 uppercase backdrop-blur-sm transition hover:border-white/20 hover:text-white sm:px-8 sm:py-3 sm:text-xs"
            >
              Capabilities
              <span className="hero-cta-arrow">↓</span>
            </a>
          </div>
        </footer>
      </div>
    </section>
  );
}
