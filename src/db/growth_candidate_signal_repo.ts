import type { Db } from "./client.js";

export async function insertGrowthCandidateSignal(
  db: Db,
  input: {
    inboundMessageId?: number | null;
    channel?: string;
    channelUserId: string;
    source: string;
    reasonCode: string;
    detail?: Record<string, unknown>;
    parsedIntentSnapshot?: unknown;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO growth_candidate_signals (
       inbound_message_id, channel, channel_user_id, source, reason_code, detail, parsed_intent_snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      input.inboundMessageId ?? null,
      input.channel ?? "line",
      input.channelUserId,
      input.source,
      input.reasonCode.slice(0, 200),
      JSON.stringify(input.detail ?? {}),
      input.parsedIntentSnapshot != null ? JSON.stringify(input.parsedIntentSnapshot) : null,
    ]
  );
}
