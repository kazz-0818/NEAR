import type { Db } from "../db/client.js";
import { getLogger } from "../lib/logger.js";

/**
 * 成長完了時に capability_registry に1行追加（将来の DB 駆動 capabilities の足がかり）
 */
export async function registerCapabilityFromGrowth(input: {
  db: Db;
  suggestionId: number;
  summary: string;
  suggestedModules: unknown;
}): Promise<void> {
  const log = getLogger();
  let intentSlug = `growth_${input.suggestionId}`;
  if (Array.isArray(input.suggestedModules) && input.suggestedModules[0]) {
    const first = String(input.suggestedModules[0]).replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    if (first.length >= 3) intentSlug = `growth_${first}`.slice(0, 80);
  }
  const line = input.summary.slice(0, 200) + (input.summary.length > 200 ? "…" : "");
  try {
    const ex = await input.db.query(`SELECT id FROM capability_registry WHERE intent_name = $1 LIMIT 1`, [
      intentSlug,
    ]);
    if (ex.rows.length > 0) {
      await input.db.query(
        `UPDATE capability_registry
         SET description = $1, user_visible_line = $2, enabled = true, updated_at = now()
         WHERE intent_name = $3`,
        [input.summary.slice(0, 500), line, intentSlug]
      );
    } else {
      await input.db.query(
        `INSERT INTO capability_registry (intent_name, description, user_visible_line, enabled, sort_order)
         VALUES ($1, $2, $3, true, 200 + $4::int)`,
        [intentSlug, input.summary.slice(0, 500), line, input.suggestionId % 1000]
      );
    }
  } catch (e) {
    log.warn({ err: e, suggestionId: input.suggestionId }, "capability_sync failed");
  }
}
