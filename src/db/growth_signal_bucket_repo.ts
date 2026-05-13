import type { Db } from "./client.js";

export async function upsertGrowthSignalBucket(
  db: Db,
  input: {
    bucketKey: string;
    userMessageFingerprint: string;
    channel: string;
    priorityScore: number;
    primarySource: string;
    lastUserText?: string;
    lastChannelUserId?: string;
    lastInboundMessageId?: number | null;
    lastParsedIntent?: unknown;
  }
): Promise<number> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO near_growth_signal_buckets (
       bucket_key, user_message_fingerprint, channel, priority_score, primary_source,
       last_user_text, last_channel_user_id, last_inbound_message_id, last_parsed_intent
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (bucket_key) DO UPDATE SET
       last_seen = now(),
       hit_count = near_growth_signal_buckets.hit_count + 1,
       priority_score = GREATEST(near_growth_signal_buckets.priority_score, EXCLUDED.priority_score),
       primary_source = CASE
         WHEN EXCLUDED.priority_score > near_growth_signal_buckets.priority_score THEN EXCLUDED.primary_source
         ELSE near_growth_signal_buckets.primary_source
       END,
       last_user_text = COALESCE(EXCLUDED.last_user_text, near_growth_signal_buckets.last_user_text),
       last_channel_user_id = COALESCE(EXCLUDED.last_channel_user_id, near_growth_signal_buckets.last_channel_user_id),
       last_inbound_message_id = COALESCE(EXCLUDED.last_inbound_message_id, near_growth_signal_buckets.last_inbound_message_id),
       last_parsed_intent = COALESCE(EXCLUDED.last_parsed_intent, near_growth_signal_buckets.last_parsed_intent)
     RETURNING id`,
    [
      input.bucketKey,
      input.userMessageFingerprint,
      input.channel,
      Math.min(100, Math.max(1, Math.round(input.priorityScore))),
      input.primarySource.slice(0, 120),
      input.lastUserText ?? null,
      input.lastChannelUserId ?? null,
      input.lastInboundMessageId ?? null,
      input.lastParsedIntent != null ? JSON.stringify(input.lastParsedIntent) : null,
    ]
  );
  const id = Number(r.rows[0]?.id ?? 0);
  if (!Number.isFinite(id) || id < 1) {
    throw new Error("upsertGrowthSignalBucket: missing id");
  }
  return id;
}

export async function hasSignalSinceBucketKey(db: Db, bucketKey: string, since: Date): Promise<boolean> {
  const r = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM near_growth_candidate_signals
     WHERE bucket_key = $1 AND created_at >= $2
     LIMIT 1`,
    [bucketKey, since]
  );
  return r.rows.length > 0;
}

export async function getGrowthSignalBucketById(
  db: Db,
  bucketId: number
): Promise<{
  id: number;
  hit_count: number;
  priority_score: number;
  primary_source: string;
  implementation_suggestion_id: number | null;
  last_user_text: string | null;
  last_parsed_intent: unknown;
  last_channel_user_id: string | null;
  last_inbound_message_id: number | null;
} | null> {
  const r = await db.query<{
    id: string;
    hit_count: string;
    priority_score: string;
    primary_source: string;
    implementation_suggestion_id: string | null;
    last_user_text: string | null;
    last_parsed_intent: unknown;
    last_channel_user_id: string | null;
    last_inbound_message_id: string | null;
  }>(
    `SELECT id, hit_count, priority_score, primary_source, implementation_suggestion_id,
            last_user_text, last_parsed_intent, last_channel_user_id, last_inbound_message_id
     FROM near_growth_signal_buckets WHERE id = $1`,
    [bucketId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    hit_count: Number(row.hit_count),
    priority_score: Number(row.priority_score),
    primary_source: row.primary_source,
    implementation_suggestion_id: row.implementation_suggestion_id != null ? Number(row.implementation_suggestion_id) : null,
    last_user_text: row.last_user_text,
    last_parsed_intent: row.last_parsed_intent,
    last_channel_user_id: row.last_channel_user_id,
    last_inbound_message_id: row.last_inbound_message_id != null ? Number(row.last_inbound_message_id) : null,
  };
}

export async function updateBucketImplementationSuggestionId(
  db: Db,
  bucketId: number,
  suggestionId: number
): Promise<void> {
  await db.query(
    `UPDATE near_growth_signal_buckets SET implementation_suggestion_id = $2 WHERE id = $1`,
    [bucketId, suggestionId]
  );
}
