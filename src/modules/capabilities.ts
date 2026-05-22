import type { Db } from "../db/client.js";
import {
  buildNearCapabilitiesHelpReply,
  NEAR_CAPABILITY_BULLETS,
} from "../lib/capabilitiesHelp.js";
import type { ModuleContext, ModuleResult } from "./types.js";

/** DB 未投入時のフォールバック（専門用語を避けた短文） */
const STATIC_CAPABILITY_LINES = [...NEAR_CAPABILITY_BULLETS];

export async function helpCapabilities(_ctx: ModuleContext): Promise<ModuleResult> {
  return { success: true, draft: buildNearCapabilitiesHelpReply(), situation: "success" };
}

/** near_capability_registry を参照。0件のときは静的フォールバック。 */
export async function listCapabilityLines(db: Db): Promise<string[]> {
  const r = await db.query<{ user_visible_line: string }>(
    `SELECT user_visible_line FROM near_capability_registry WHERE enabled = true ORDER BY sort_order ASC`
  );
  if (r.rows.length === 0) return [...STATIC_CAPABILITY_LINES];
  return r.rows.map((row) => row.user_visible_line);
}
