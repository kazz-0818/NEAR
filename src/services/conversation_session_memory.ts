/**
 * 短期会話セッションメモリ（「これ」「1番」解決用）。
 * 永続プロフィールではなく expires_at を必ず見る。
 */

import type { Db } from "../db/client.js";
import { getLogger } from "../lib/logger.js";

export type SessionMemoryType =
  | "latest_task_created"
  | "latest_task_list"
  | "latest_reminder_created"
  | "latest_reminder_list"
  | "latest_reminder_updated"
  | "latest_drive_candidates"
  | "latest_sheet_candidates"
  | "latest_growth_candidate"
  | "latest_capsule_candidate"
  | "latest_near_reply_type";

const DEFAULT_KEY = "";

export async function upsertSessionMemory(
  db: Db,
  input: {
    channelUserId: string;
    memoryType: SessionMemoryType;
    memoryKey?: string;
    value: unknown;
    sourceMessageId?: number | null;
    sourceRoute?: string | null;
    expiresAt: Date;
  }
): Promise<void> {
  const key = input.memoryKey ?? DEFAULT_KEY;
  try {
    await db.query(
      `INSERT INTO near_conversation_session_memory (
         channel_user_id, memory_type, memory_key, memory_value_json, source_message_id, source_route, expires_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       ON CONFLICT (channel_user_id, memory_type, memory_key)
       DO UPDATE SET
         memory_value_json = EXCLUDED.memory_value_json,
         source_message_id = EXCLUDED.source_message_id,
         source_route = EXCLUDED.source_route,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
      [
        input.channelUserId,
        input.memoryType,
        key,
        JSON.stringify(input.value ?? {}),
        input.sourceMessageId ?? null,
        input.sourceRoute ?? null,
        input.expiresAt.toISOString(),
      ]
    );
  } catch (e) {
    getLogger().warn({ err: e, memoryType: input.memoryType }, "upsertSessionMemory failed");
  }
}

export async function getSessionMemoryValue<T = unknown>(
  db: Db,
  channelUserId: string,
  memoryType: SessionMemoryType,
  memoryKey: string = DEFAULT_KEY
): Promise<T | null> {
  try {
    const r = await db.query<{ memory_value_json: unknown }>(
      `SELECT memory_value_json FROM near_conversation_session_memory
       WHERE channel_user_id = $1 AND memory_type = $2 AND memory_key = $3
         AND expires_at > now()
       LIMIT 1`,
      [channelUserId, memoryType, memoryKey]
    );
    const row = r.rows[0];
    if (!row) return null;
    return row.memory_value_json as T;
  } catch (e) {
    getLogger().warn({ err: e }, "getSessionMemoryValue failed");
    return null;
  }
}

/** メモリが期限切れなら null（テスト用に export） */
export function isExpiredMemory(expiresAtIso: string, now: Date = new Date()): boolean {
  const t = new Date(expiresAtIso).getTime();
  return !Number.isFinite(t) || t <= now.getTime();
}
