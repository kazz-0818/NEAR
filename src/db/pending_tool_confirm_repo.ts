import { randomUUID } from "node:crypto";
import type { Db } from "./client.js";

export type PendingToolRow = {
  id: string;
  tool_name: string;
  args_json: Record<string, unknown>;
};

/** 同一ユーザーの未確定を消してから新規作成（1 件のみ active） */
export async function replacePendingToolConfirmation(
  db: Db,
  input: {
    channel: string;
    channelUserId: string;
    toolName: string;
    argsJson: Record<string, unknown>;
    inboundMessageId: number;
    ttlMinutes: number;
  }
): Promise<void> {
  await db.query(`DELETE FROM pending_tool_confirmations WHERE channel = $1 AND channel_user_id = $2 AND status = 'pending'`, [
    input.channel,
    input.channelUserId,
  ]);
  const nonce = randomUUID();
  const mins = Math.max(1, Math.min(120, input.ttlMinutes));
  await db.query(
    `INSERT INTO pending_tool_confirmations (
       expires_at, channel, channel_user_id, status, tool_name, args_json, inbound_message_id, confirmation_nonce
     ) VALUES (now() + ($1::int * interval '1 minute'), $2, $3, 'pending', $4, $5::jsonb, $6, $7)`,
    [
      mins,
      input.channel,
      input.channelUserId,
      input.toolName,
      JSON.stringify(input.argsJson),
      input.inboundMessageId,
      nonce,
    ]
  );
}

export async function getPendingToolConfirmation(
  db: Db,
  channel: string,
  channelUserId: string
): Promise<PendingToolRow | null> {
  const r = await db.query<{ id: string; tool_name: string; args_json: unknown }>(
    `SELECT id::text, tool_name, args_json FROM pending_tool_confirmations
     WHERE channel = $1 AND channel_user_id = $2 AND status = 'pending' AND expires_at > now()
     LIMIT 1`,
    [channel, channelUserId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const aj = row.args_json;
  const args = aj && typeof aj === "object" && !Array.isArray(aj) ? (aj as Record<string, unknown>) : {};
  return { id: row.id, tool_name: row.tool_name, args_json: args };
}

export async function cancelPendingToolConfirmation(db: Db, channel: string, channelUserId: string): Promise<void> {
  await db.query(
    `UPDATE pending_tool_confirmations SET status = 'cancelled'
     WHERE channel = $1 AND channel_user_id = $2 AND status = 'pending'`,
    [channel, channelUserId]
  );
}

/** 肯定後に行を executed にし、保存済み args を返す（再パースしない） */
export async function finalizePendingToolConfirmation(
  db: Db,
  channel: string,
  channelUserId: string
): Promise<PendingToolRow | null> {
  const r = await db.query<{ id: string; tool_name: string; args_json: unknown }>(
    `UPDATE pending_tool_confirmations SET status = 'executed'
     WHERE id = (
       SELECT id FROM pending_tool_confirmations
       WHERE channel = $1 AND channel_user_id = $2 AND status = 'pending' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1
     )
     RETURNING id::text, tool_name, args_json`,
    [channel, channelUserId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const aj = row.args_json;
  const args = aj && typeof aj === "object" && !Array.isArray(aj) ? (aj as Record<string, unknown>) : {};
  return { id: row.id, tool_name: row.tool_name, args_json: args };
}
