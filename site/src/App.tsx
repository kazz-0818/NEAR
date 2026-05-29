import { useEffect, useRef } from "react";
import showcaseRaw from "./data/showcase.json";
import type { ShowcaseAgent, ShowcaseData } from "./types/showcase";
import { HeroScene } from "./components/HeroScene";
import { AgentSection } from "./components/AgentSection";
import { PhaseRoadmap } from "./components/PhaseRoadmap";
import { SiteFooter } from "./components/SiteFooter";
import { CosmicBackground } from "./components/CosmicBackground";
import { useRevealOnScroll } from "./hooks/useRevealOnScroll";
import { useTabAnimationsPaused } from "./hooks/useTabAnimationsPaused";
import { useReducedMotion } from "./hooks/useReducedMotion";
import { AGENT_ACCENTS, SECTION_ORDER } from "./lib/colors";

const data = showcaseRaw as ShowcaseData;
const agentsById = Object.fromEntries(
  data.agents.map((a) => [a.id, { ...a, accent: AGENT_ACCENTS[a.id] ?? a.accent }]),
);
const agents = SECTION_ORDER.map((id) => agentsById[id]).filter(
  (a): a is ShowcaseAgent => Boolean(a),
);

function Nav() {
  const navRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || reduced) return;

    const onScroll = () => {
      const p = Math.min(window.scrollY / 200, 1);
      nav.style.backgroundColor = `rgba(5, 5, 8, ${0.55 + p * 0.35})`;
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reduced]);

  return (
    <nav
      ref={navRef}
      className="fixed top-0 right-0 left-0 z-50 flex items-center justify-between border-b border-white/5 bg-[#050508]/60 px-5 py-3.5 backdrop-blur-md sm:px-8 lg:px-10"
    >
      <a
        href="#hero"
        className="font-display text-xs font-bold tracking-[0.2em] text-slate-200 uppercase sm:text-sm"
      >
        {data.meta.title}
      </a>
      <div className="flex gap-5 font-display text-[10px] tracking-[0.12em] text-slate-500 uppercase sm:gap-6">
        <a href="#hero" className="transition hover:text-white">
          Members
        </a>
        <a href="#units" className="transition hover:text-white">
          Units
        </a>
        <a href="#roadmap" className="transition hover:text-white">
          Roadmap
        </a>
      </div>
    </nav>
  );
}

function SectionDivider() {
  const ref = useRef<HTMLDivElement>(null);
  useRevealOnScroll(ref);

  return (
    <div
      ref={ref}
      className="reveal-root scroll-reveal-scale section-divider mx-auto h-px w-full max-w-3xl origin-center bg-gradient-to-r from-transparent via-white/15 to-transparent"
    />
  );
}

export default function App() {
  useTabAnimationsPaused();

  return (
    <div className="relative min-h-screen">
      <CosmicBackground />
      <Nav />
      <main className="relative z-10">
        <HeroScene
          title={data.meta.title}
          tagline={data.meta.tagline}
          subtitle={data.meta.subtitle}
          agents={agents}
        />
        <SectionDivider />
        <div id="units" className="mx-auto max-w-5xl lg:max-w-6xl">
          {agents.map((agent, index) => (
            <AgentSection key={agent.id} agent={agent} index={index} />
          ))}
        </div>
        <SectionDivider />
        <PhaseRoadmap phases={data.phases} />
      </main>
      <SiteFooter className="relative z-10" />
    </div>
  );
}
