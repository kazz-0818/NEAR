/**
 * IRIE agent folder — 参照用。実行は IRIE リポジトリ（app/）の既存経路のまま。
 */
import { getVelioraAgentByKey } from "../registry.js";

export const AGENT_KEY = "irie" as const;

export function getAgentConfig() {
  const def = getVelioraAgentByKey(AGENT_KEY);
  if (!def) throw new Error(`Agent ${AGENT_KEY} not in registry`);
  return def;
}

export const IMPLEMENTATION_PATHS = {
  primary: "(IRIE repo — IRIE service)",
  secondary: "app/",
} as const;

export const VELIORA_TABLES_USED = [
  "veliora.ai_agents",
  "veliora.conversations",
  "veliora.messages",
] as const;
