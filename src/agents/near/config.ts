/**
 * NEAR agent folder — 参照用。実行は既存経路のまま。
 */
import { getVelioraAgentByKey } from "../registry.js";

export const AGENT_KEY = "near" as const;

export function getAgentConfig() {
  const def = getVelioraAgentByKey(AGENT_KEY);
  if (!def) throw new Error(`Agent ${AGENT_KEY} not in registry`);
  return def;
}

export const IMPLEMENTATION_PATHS = {
  primary: "../../services/orchestrator.ts",
  secondary: "../../modules/",
} as const;

export const VELIORA_TABLES_USED = [
  "veliora.ai_agents",
  "veliora.conversations",
  "veliora.messages",
] as const;
