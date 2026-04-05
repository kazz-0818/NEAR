import { getEnv } from "../config/env.js";
import type { Db } from "../db/client.js";
import {
  inferImprovementKind,
  messageFingerprint,
  type ImprovementKind,
} from "../lib/messageFingerprint.js";
import type { ParsedIntent } from "../models/intent.js";

export type GrowthGateResult = { allow: boolean; reason: string };

/**
 * 未対応は記録済み前提。implementation_suggestions / 管理者通知に進めてよいかを判定する。
 */
export async function evaluateGrowthSuggestionEligibility(input: {
  db: Db;
  text: string;
  parsed: ParsedIntent;
}): Promise<GrowthGateResult> {
  const env = getEnv();

  if (env.GROWTH_SUGGESTION_GATE_ENABLED === false) {
    return { allow: true, reason: "gate_disabled" };
  }

  const trimmed = input.text.normalize("NFKC").trim();
  const improvementKind: ImprovementKind = inferImprovementKind(input.text, input.parsed);
  const fingerprint = messageFingerprint(input.text);

  if (env.GROWTH_SKIP_OUT_OF_SCOPE && improvementKind === "out_of_scope") {
    return { allow: false, reason: "out_of_scope" };
  }

  if (env.GROWTH_SKIP_WHEN_FOLLOWUP && input.parsed.needs_followup === true) {
    return { allow: false, reason: "needs_followup" };
  }

  if (env.GROWTH_MIN_MESSAGE_CHARS > 0 && [...trimmed].length < env.GROWTH_MIN_MESSAGE_CHARS) {
    return { allow: false, reason: "message_too_short" };
  }

  const minConf = env.GROWTH_MIN_CONFIDENCE_UNKNOWN;
  if (
    minConf > 0 &&
    input.parsed.intent === "unknown_custom_request" &&
    input.parsed.confidence > 0 &&
    input.parsed.confidence < minConf
  ) {
    return { allow: false, reason: "low_confidence_unknown" };
  }

  const minHits = env.GROWTH_MIN_FINGERPRINT_COUNT;
  if (minHits > 1) {
    const cnt = await countByFingerprint(input.db, fingerprint);
    if (cnt < minHits) {
      return { allow: false, reason: `fingerprint_count_${cnt}_lt_${minHits}` };
    }
  }

  return { allow: true, reason: "ok" };
}

async function countByFingerprint(db: Db, fingerprint: string): Promise<number> {
  const r = await db.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM unsupported_requests WHERE message_fingerprint = $1`,
    [fingerprint]
  );
  const n = Number(r.rows[0]?.c ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** 成長パイプラインに載せなかったときの status / notes */
export async function markUnsupportedGrowthSkipped(
  db: Db,
  unsupportedId: number,
  gateReason: string
): Promise<void> {
  const line = `[growth_gate] ${gateReason} @ ${new Date().toISOString()}`;
  await db.query(
    `UPDATE unsupported_requests
     SET status = 'growth_skipped',
         notes = CASE
           WHEN notes IS NULL OR btrim(notes) = '' THEN $1
           ELSE notes || E'\n' || $1
         END,
         updated_at = now()
     WHERE id = $2`,
    [line, unsupportedId]
  );
}
