import { Suspense, lazy } from "react";
import { Canvas } from "@react-three/fiber";
import type { ShowcaseAgent } from "../types/showcase";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { MemberHud } from "./MemberHud";
import { AgentIcon } from "./AgentIcon";
import { RING_ORDER } from "../lib/colors";
import { agentSectionId, scrollToId } from "../lib/agents";

const FlyingAgents3D = lazy(() =>
  import("./FlyingAgents3D").then((m) => ({ default: m.FlyingAgents3D })),
);

function HeroCanvas({ agents }: { agents: ShowcaseAgent[] }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 7.5], fov: 48 }}
      dpr={[1, 1.25]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      }}
      style={{ position: "absolute", inset: 0 }}
      eventPrefix="client"
    >
      <color attach="background" args={["#050508"]} />
      <Suspense fallback={null}>
        <FlyingAgents3D agents={agents} />
      </Suspense>
    </Canvas>
  );
}

function StaticMemberRow({ agents }: { agents: ShowcaseAgent[] }) {
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  return (
    <div className="flex flex-wrap justify-center gap-4 py-8">
      {RING_ORDER.map((id) => {
        const agent = byId[id];
        if (!agent) return null;
        return (
          <button
            key={id}
            type="button"
            onClick={() => scrollToId(agentSectionId(agent))}
            className="flex flex-col items-center gap-2"
          >
            <AgentIcon
              agentId={agent.id}
              alt={agent.displayName}
              glow={agent.accent}
              className="h-16 w-16 rounded-full"
            />
            <span className="font-display text-[10px] tracking-widest uppercase" style={{ color: agent.accent }}>
              {agent.code}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface HeroSceneProps {
  title: string;
  tagline: string;
  subtitle: string;
  agents: ShowcaseAgent[];
}

export function HeroScene({ title, tagline, subtitle, agents }: HeroSceneProps) {
  const reduced = useReducedMotion();

  return (
    <section
      id="hero"
      className="relative min-h-[100svh] overflow-hidden"
    >
      <div className="absolute inset-0">
        {!reduced ? (
          <HeroCanvas agents={agents} />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background:
                "radial-gradient(ellipse 70% 50% at 50% 45%, rgba(244,114,182,0.08), transparent 60%), radial-gradient(ellipse 40% 30% at 70% 30%, rgba(250,204,21,0.06), transparent)",
            }}
          />
        )}
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-20" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-5xl flex-col px-5 pt-[5.5rem] pb-10 sm:px-8 lg:max-w-6xl lg:px-10">
        <header className="shrink-0 text-center">
          <p className="hero-chip mb-2 font-display text-[10px] tracking-[0.45em] text-slate-400 uppercase sm:text-xs">
            Organization OS
          </p>
          <h1
            className="hero-title font-display text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl"
            style={{ textShadow: "0 0 48px rgba(255,255,255,0.12)" }}
          >
            <span className="hero-glitch">{title}</span>
          </h1>
          <p className="hero-tag mt-2 font-display text-xs tracking-[0.18em] text-slate-400 sm:text-sm lg:text-base">
            {tagline}
          </p>
        </header>

        <div className="hero-stage relative min-h-0 flex-1">
          {reduced && <StaticMemberRow agents={agents} />}
          {!reduced && (
            <p className="pointer-events-none absolute bottom-4 left-0 right-0 text-center font-display text-[9px] tracking-[0.35em] text-slate-600 uppercase sm:text-[10px]">
              メンバーは宙に浮遊 — クリックで詳細
            </p>
          )}
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
