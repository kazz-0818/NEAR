import type { Db } from "./client.js";

export async function upsertGrowthSignalBucket(
  db: Db,
  input: {
    bucketKey: string;
    userMessageFingerprint: string;
    channel: string;
    priorityScore: number;
    primarySource: string;
  }
): Promise<number> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO growth_signal_buckets (
       bucket_key, user_message_fingerprint, channel, priority_score, primary_source
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (bucket_key) DO UPDATE SET
       last_seen = now(),
       hit_count = growth_signal_buckets.hit_count + 1,
       priority_score = GREATEST(growth_signal_buckets.priority_score, EXCLUDED.priority_score),
       primary_source = CASE
         WHEN EXCLUDED.priority_score > growth_signal_buckets.priority_score THEN EXCLUDED.primary_source
         ELSE growth_signal_buckets.primary_source
       END
     RETURNING id`,
    [
      input.bucketKey,
      input.userMessageFingerprint,
      input.channel,
      Math.min(100, Math.max(1, Math.round(input.priorityScore))),
      input.primarySource.slice(0, 120),
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
    `SELECT 1 AS one FROM growth_candidate_signals
     WHERE bucket_key = $1 AND created_at >= $2
     LIMIT 1`,
    [bucketKey, since]
  );
  return r.rows.length > 0;
}
