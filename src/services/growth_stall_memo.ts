import type { Db } from "../db/client.js";

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function escapeForMemo(s: string): string {
  return clip(s, 220).replace(/\r?\n/g, " ").replace(/"/g, "'");
}

export type GrowthStallKind =
  | "consent_unclear"
  | "consent_deferred"
  | "hearing_deferred"
  | "hearing_too_short";

/**
 * 成長フローが「この段階で待ち」になったままのユーザー発言を記録する。
 * implementation_suggestions.review_notes と unsupported_requests.notes の両方に追記。
 */
export async function appendGrowthStallMemo(
  db: Db,
  suggestionId: number,
  kind: GrowthStallKind,
  userText: string
): Promise<void> {
  const iso = new Date().toISOString();
  const snippet = escapeForMemo(userText);
  const line = `[growth_stall] ${iso} ${kind} text="${snippet}"`;

  await db.query(
    `UPDATE implementation_suggestions
     SET review_notes = CASE
           WHEN review_notes IS NULL OR btrim(review_notes) = '' THEN $1
           ELSE review_notes || E'\n' || $1
         END,
         updated_at = now()
     WHERE id = $2`,
    [line, suggestionId]
  );

  await db.query(
    `UPDATE unsupported_requests u
     SET notes = CASE
           WHEN u.notes IS NULL OR btrim(u.notes) = '' THEN $2
           ELSE u.notes || E'\n' || $2
         END,
         updated_at = now()
     FROM implementation_suggestions s
     WHERE s.id = $1 AND u.id = s.unsupported_request_id`,
    [suggestionId, line]
  );
}
