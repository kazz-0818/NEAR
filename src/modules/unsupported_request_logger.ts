import type { Db } from "../db/client.js";
import { inferImprovementKind, messageFingerprint } from "../lib/messageFingerprint.js";
import type { ParsedIntent } from "../models/intent.js";

export type LogUnsupportedInput = {
  db: Db;
  channel: string;
  channelUserId: string;
  originalMessage: string;
  intent: ParsedIntent;
  inboundMessageId: number;
  whyOverride?: string;
};

export async function logUnsupportedRequest(input: LogUnsupportedInput): Promise<number> {
  const why =
    input.whyOverride ??
    input.intent.reason ??
    (input.intent.can_handle ? "該当モジュールなし" : "未対応の依頼分類");
  const category =
    input.intent.suggested_category ?? (input.intent.intent === "unknown_custom_request" ? "その他" : "機能拡張");
  const fingerprint = messageFingerprint(input.originalMessage);
  const improvementKind = inferImprovementKind(input.originalMessage, input.intent);

  const normalizedMessage = input.originalMessage.normalize("NFKC").trim();

  const res = await input.db.query<{ id: string }>(
    `INSERT INTO unsupported_requests (
       channel, channel_user_id, original_message, detected_intent, why_unsupported,
       suggested_implementation_category, priority, status, notes, confidence, inbound_message_id,
       message_fingerprint, improvement_kind, normalized_message, intent_guess
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'logged', $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      input.channel,
      input.channelUserId,
      input.originalMessage,
      input.intent.intent,
      why,
      category,
      0,
      null,
      input.intent.confidence,
      input.inboundMessageId,
      fingerprint,
      improvementKind,
      normalizedMessage,
      input.intent.intent,
    ]
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to insert unsupported_requests");
  return Number(id);
}

/** growth_signal_buckets からの昇格用。既存の suggestion / JOIN 互換のため unsupported 行を合成する。 */
export async function logUnsupportedFromGrowthBucket(input: LogUnsupportedInput & { growthSignalBucketId: number }): Promise<number> {
  const why =
    input.whyOverride ?? "成長シグナルバケットからの昇格（agent/FAQ 等の未解決シグナル）";
  const category = input.intent.suggested_category ?? "機能拡張";
  const fingerprint = messageFingerprint(input.originalMessage);
  const improvementKind = inferImprovementKind(input.originalMessage, input.intent);
  const normalizedMessage = input.originalMessage.normalize("NFKC").trim();

  const res = await input.db.query<{ id: string }>(
    `INSERT INTO unsupported_requests (
       channel, channel_user_id, original_message, detected_intent, why_unsupported,
       suggested_implementation_category, priority, status, notes, confidence, inbound_message_id,
       message_fingerprint, improvement_kind, normalized_message, intent_guess,
       entry_source, growth_signal_bucket_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'logged', $8, $9, $10, $11, $12, $13, $14, 'growth_signal_bucket', $15)
     RETURNING id`,
    [
      input.channel,
      input.channelUserId,
      input.originalMessage,
      input.intent.intent,
      why,
      category,
      0,
      null,
      input.intent.confidence,
      input.inboundMessageId,
      fingerprint,
      improvementKind,
      normalizedMessage,
      input.intent.intent,
      input.growthSignalBucketId,
    ]
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to insert unsupported_requests (growth bucket)");
  return Number(id);
}
