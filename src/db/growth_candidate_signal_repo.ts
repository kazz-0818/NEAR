import type { Db } from "./client.js";

export async function insertGrowthCandidateSignalRow(
  db: Db,
  input: {
    inboundMessageId?: number | null;
    channel?: string;
    channelUserId: string;
    source: string;
    reasonCode: string;
    detail?: Record<string, unknown>;
    parsedIntentSnapshot?: unknown;
    bucketId: number;
    userMessageFingerprint: string;
    bucketKey: string;
    priorityScore: number;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO growth_candidate_signals (
       inbound_message_id, channel, channel_user_id, source, reason_code, detail, parsed_intent_snapshot,
       bucket_id, user_message_fingerprint, bucket_key, priority_score
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)`,
    [
      input.inboundMessageId ?? null,
      input.channel ?? "line",
      input.channelUserId,
      input.source,
      input.reasonCode.slice(0, 200),
      JSON.stringify(input.detail ?? {}),
      input.parsedIntentSnapshot != null ? JSON.stringify(input.parsedIntentSnapshot) : null,
      input.bucketId,
      input.userMessageFingerprint,
      input.bucketKey,
      Math.min(100, Math.max(1, Math.round(input.priorityScore))),
    ]
  );
}
