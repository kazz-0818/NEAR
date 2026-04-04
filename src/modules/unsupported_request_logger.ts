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

  const res = await input.db.query<{ id: string }>(
    `INSERT INTO unsupported_requests (
       channel, channel_user_id, original_message, detected_intent, why_unsupported,
       suggested_implementation_category, priority, status, notes, confidence, inbound_message_id,
       message_fingerprint, improvement_kind
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'logged', $8, $9, $10, $11, $12)
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
    ]
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to insert unsupported_requests");
  return Number(id);
}
