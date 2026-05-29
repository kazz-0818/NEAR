import type { ShowcaseAgent } from "../types/showcase";

const ICON_MAP: Record<string, string> = {
  near: "NEAR",
  sera: "SERA",
  irie: "IRIE",
  rits: "RITS",
  lram: "LRAM",
  core: "CORE",
};

/** Vite base（GitHub Pages では `/NEAR/`）を含むパス */
export function iconBase(agentId: string): string {
  const code = ICON_MAP[agentId] ?? agentId.toUpperCase();
  const base = import.meta.env.BASE_URL;
  return `${base}icons/${code}_ICON`;
}

/** 組織ロゴ（public/veliora-icon-logo.{webp,png}） */
export function velioraLogoBase(): string {
  return `${import.meta.env.BASE_URL}veliora-icon-logo`;
}

export function agentSectionId(agent: ShowcaseAgent): string {
  return `agent-${agent.id}`;
}

/** 固定ナビ分を除いて、エージェント紹介ブロック先頭へスクロール */
export function scrollToAgentSection(agent: ShowcaseAgent) {
  const section = document.getElementById(agentSectionId(agent));
  if (!section) return;

  const target =
    section.querySelector<HTMLElement>(".agent-section-head") ?? section;
  const nav = document.querySelector("nav");
  const offset = (nav?.getBoundingClientRect().height ?? 64) + 20;

  const run = () => {
    const y = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  };

  run();
  window.setTimeout(run, 450);
}

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const nav = document.querySelector("nav");
  const offset = (nav?.getBoundingClientRect().height ?? 64) + 20;
  const y = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}
