import type { ShowcaseAgent } from "../types/showcase";

const ICON_MAP: Record<string, string> = {
  near: "NEAR",
  sera: "SERA",
  lira: "LIRA",
  rits: "RITS",
  lram: "LRAM",
};

export function iconBase(agentId: string): string {
  const code = ICON_MAP[agentId] ?? agentId.toUpperCase();
  return `/icons/${code}_ICON`;
}

export function agentSectionId(agent: ShowcaseAgent): string {
  return `agent-${agent.id}`;
}

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}
