import type { ModuleResult } from "../modules/types.js";

export type AgentComposeSituation = ModuleResult["situation"];

const rank: Record<AgentComposeSituation, number> = {
  success: 0,
  followup: 1,
  unsupported: 2,
  error: 3,
};

/** ツール群のうち composeNearReply に最も強い situation を採用（error > unsupported > followup > success） */
export function mergeModuleSituations(
  current: AgentComposeSituation,
  next?: ModuleResult["situation"]
): AgentComposeSituation {
  if (!next) return current;
  return rank[next] > rank[current] ? next : current;
}
