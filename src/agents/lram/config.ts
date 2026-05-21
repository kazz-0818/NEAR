/**
 * LRAM agent folder — 参照用。実行は既存経路のまま。
 */
import { getVerioraAgentByKey } from "../registry.js";

export const AGENT_KEY = "lram" as const;

export function getAgentConfig() {
  const def = getVerioraAgentByKey(AGENT_KEY);
  if (!def) throw new Error(`Agent ${AGENT_KEY} not in registry`);
  return def;
}

export const IMPLEMENTATION_PATHS = {
  primary: "(LRAM repo)",
  secondary: "src/agents/lram/",
} as const;

export const VERIORA_TABLES_USED = [
  "veriora.ai_agents",
  "veriora.conversations",
  "veriora.messages",
] as const;
