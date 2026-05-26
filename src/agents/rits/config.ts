/**
 * RITS agent folder — 参照用。実行は既存経路のまま。
 */
import { getVelioraAgentByKey } from "../registry.js";

export const AGENT_KEY = "rits" as const;

export function getAgentConfig() {
  const def = getVelioraAgentByKey(AGENT_KEY);
  if (!def) throw new Error(`Agent ${AGENT_KEY} not in registry`);
  return def;
}

export const IMPLEMENTATION_PATHS = {
  primary: "(RITS repo)",
  secondary: "src/services/",
} as const;

export const VERIORA_TABLES_USED = [
  "veriora.ai_agents",
  "veriora.conversations",
  "veriora.messages",
] as const;
