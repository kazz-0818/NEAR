import type { Db } from "./client.js";

export type PendingClarificationRow = {
  id: number;
  kind: string;
  required_slot: string;
  payload_json: Record<string, unknown>;
};

export async function replacePendingClarification(
  db: Db,
  input: {
    channel: string;
    channelUserId: string;
    actorUserId?: string | null;
    groupId?: string | null;
    kind: string;
    requiredSlot: string;
    payloadJson: Record<string, unknown>;
    inboundMessageId?: number | null;
    ttlMinutes: number;
  }
): Promise<void> {
  await db.query(
    `UPDATE near_pending_clarifications
       SET status = 'cancelled', updated_at = now()
     WHERE channel = $1
       AND channel_user_id = $2
       AND actor_user_id IS NOT DISTINCT FROM $3
       AND group_id IS NOT DISTINCT FROM $4
       AND status = 'pending'`,
    [input.channel, input.channelUserId, input.actorUserId ?? null, input.groupId ?? null]
  );
  const ttl = Math.max(1, Math.min(180, input.ttlMinutes));
  await db.query(
    `INSERT INTO near_pending_clarifications (
      channel, channel_user_id, actor_user_id, group_id, kind, status, required_slot, payload_json, inbound_message_id, expires_at
    ) VALUES (
      $1, $2, $3, $4, $5, 'pending', $6, $7::jsonb, $8, now() + ($9::int * interval '1 minute')
    )`,
    [
      input.channel,
      input.channelUserId,
      input.actorUserId ?? null,
      input.groupId ?? null,
      input.kind,
      input.requiredSlot,
      JSON.stringify(input.payloadJson),
      input.inboundMessageId ?? null,
      ttl,
    ]
  );
}

export async function getPendingClarification(
  db: Db,
  input: {
    channel: string;
    channelUserId: string;
    actorUserId?: string | null;
    groupId?: string | null;
  }
): Promise<PendingClarificationRow | null> {
  const r = await db.query<{
    id: string;
    kind: string;
    required_slot: string;
    payload_json: unknown;
  }>(
    `SELECT id::text, kind, required_slot, payload_json
       FROM near_pending_clarifications
      WHERE channel = $1
        AND channel_user_id = $2
        AND actor_user_id IS NOT DISTINCT FROM $3
        AND group_id IS NOT DISTINCT FROM $4
        AND status = 'pending'
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.channel, input.channelUserId, input.actorUserId ?? null, input.groupId ?? null]
  );
  const row = r.rows[0];
  if (!row) return null;
  const payloadJson =
    row.payload_json && typeof row.payload_json === "object" && !Array.isArray(row.payload_json)
      ? (row.payload_json as Record<string, unknown>)
      : {};
  return {
    id: Number.parseInt(row.id, 10),
    kind: row.kind,
    required_slot: row.required_slot,
    payload_json: payloadJson,
  };
}

export async function markPendingClarificationStatus(db: Db, id: number, status: "consumed" | "cancelled"): Promise<void> {
  await db.query(
    `UPDATE near_pending_clarifications
        SET status = $2, updated_at = now()
      WHERE id = $1`,
    [id, status]
  );
}
