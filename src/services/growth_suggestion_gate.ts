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

  // 定型インテントは絶対に成長候補にしない（正常動作しているものを誤検知しないよう明示的にブロック）
  const ALWAYS_HANDLED_INTENTS = new Set([
    "greeting",
    "help_capabilities",
    "simple_question",
    "task_create",
    "memo_save",
    "summarize",
    "reminder_request",
    "google_sheets_query",
    "google_calendar_query",
  ]);
  if (ALWAYS_HANDLED_INTENTS.has(input.parsed.intent)) {
    return { allow: false, reason: "always_handled_intent" };
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
    const cnt = await countFingerprintEvidence(input.db, fingerprint);
    if (cnt < minHits) {
      return { allow: false, reason: `fingerprint_count_${cnt}_lt_${minHits}` };
    }
  }

  return { allow: true, reason: "ok" };
}

async function countUnsupportedByFingerprint(db: Db, fingerprint: string): Promise<number> {
  const r = await db.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM unsupported_requests WHERE message_fingerprint = $1`,
    [fingerprint]
  );
  const n = Number(r.rows[0]?.c ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** growth_signal_buckets の hit を同一 user_message_fingerprint で足し込み（agent 経路の「証拠」）。 */
async function sumBucketHitEvidence(db: Db, fingerprint: string, capPerBucket: number): Promise<number> {
  const r = await db.query<{ s: string }>(
    `SELECT COALESCE(SUM(LEAST(GREATEST(hit_count, 0), $2)), 0)::text AS s
     FROM growth_signal_buckets WHERE user_message_fingerprint = $1`,
    [fingerprint, capPerBucket]
  );
  const n = Number(r.rows[0]?.s ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function countFingerprintEvidence(db: Db, fingerprint: string): Promise<number> {
  const env = getEnv();
  let cnt = await countUnsupportedByFingerprint(db, fingerprint);
  if (env.GROWTH_FINGERPRINT_INCLUDE_BUCKETS) {
    const b = await sumBucketHitEvidence(db, fingerprint, env.GROWTH_BUCKET_FP_HIT_CAP);
    cnt += Math.floor(b * env.GROWTH_BUCKET_FP_WEIGHT);
  }
  return cnt;
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
