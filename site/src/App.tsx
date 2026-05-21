import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import showcaseRaw from "./data/showcase.json";
import type { ShowcaseData } from "./types/showcase";
import { HeroScene } from "./components/HeroScene";
import { AgentSection } from "./components/AgentSection";
import { PhaseRoadmap } from "./components/PhaseRoadmap";
import { SiteFooter } from "./components/SiteFooter";
import { useSmoothScroll } from "./hooks/useSmoothScroll";
import { useReducedMotion } from "./hooks/useReducedMotion";
import { AGENT_ACCENTS } from "./lib/colors";

gsap.registerPlugin(ScrollTrigger);

const data = showcaseRaw as ShowcaseData;
const agents = data.agents.map((a) => ({
  ...a,
  accent: AGENT_ACCENTS[a.id] ?? a.accent,
}));

function Nav() {
  const navRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !navRef.current) return;
    const st = ScrollTrigger.create({
      start: "top -80",
      onUpdate: (self) => {
        const p = Math.min(self.scroll() / 200, 1);
        gsap.to(navRef.current, {
          backgroundColor: `rgba(5, 5, 8, ${0.55 + p * 0.35})`,
          duration: 0.2,
        });
      },
    });
    return () => st.kill();
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
        <a href="#roadmap" className="hidden transition hover:text-white sm:inline">
          Roadmap
        </a>
      </div>
    </nav>
  );
}

function HeroAnimations() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;

    const ctx = gsap.context(() => {
      const ease = "power3.out";
      gsap.fromTo(
        ".hero-chip",
        { y: 16, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, ease },
      );
      gsap.fromTo(
        ".hero-title",
        { y: 36, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.85, ease, delay: 0.08 },
      );
      gsap.fromTo(
        ".hero-tag",
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, ease, delay: 0.18 },
      );
      gsap.fromTo(
        ".hero-stage",
        { opacity: 0 },
        { opacity: 1, duration: 0.5, ease, delay: 0.15 },
      );
      gsap.fromTo(
        ".hero-footer",
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.65, ease, delay: 0.35 },
      );
      gsap.to(".hero-cta-arrow", {
        y: 4,
        duration: 0.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    });

    return () => ctx.revert();
  }, [reduced]);

  return null;
}

function SectionDivider() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    gsap.utils.toArray<HTMLElement>(".section-divider").forEach((el) => {
      gsap.fromTo(
        el,
        { scaleX: 0 },
        {
          scaleX: 1,
          scrollTrigger: { trigger: el, start: "top 92%" },
          duration: 0.9,
          ease: "power4.inOut",
        },
      );
    });
  }, [reduced]);
  return (
    <div className="section-divider mx-auto h-px w-full max-w-3xl origin-center bg-gradient-to-r from-transparent via-white/15 to-transparent" />
  );
}

export default function App() {
  useSmoothScroll();

  return (
    <div className="scanlines relative min-h-screen">
      <Nav />
      <HeroAnimations />
      <main>
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
      <SiteFooter />
    </div>
  );
}
