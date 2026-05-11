/**
 * LINE 1ターンあたりのルーティング要約を保存（デバッグ用）。
 * 失敗しても通常会話に影響しないよう呼び出し側で .catch する。
 */

import type { Db } from "../db/client.js";
import { getLogger } from "../lib/logger.js";

export type RoutingTracePatch = Partial<{
  route: string;
  module_name: string | null;
  intent: string | null;
  confidence: number | null;
  reason: string | null;
  used_llm_fallback: boolean;
  used_growth_pipeline: boolean;
  used_improvement_capsule_candidate: boolean;
  used_pending: boolean;
  cleared_pending: boolean;
  pending_type: string | null;
  pending_id: string | null;
  sheet_used: boolean;
  drive_used: boolean;
  reminder_used: boolean;
  task_used: boolean;
  github_used: boolean;
  final_reply_summary: string | null;
  meta_json: Record<string, unknown> | null;
}>;

export type RoutingTraceRow = {
  trace_id: string;
  channel_user_id: string;
  inbound_message_id: string;
  user_message: string | null;
  route: string;
  module_name: string | null;
  intent: string | null;
  confidence: number | null;
  reason: string | null;
  used_llm_fallback: boolean;
  used_growth_pipeline: boolean;
  used_improvement_capsule_candidate: boolean;
  used_pending: boolean;
  cleared_pending: boolean;
  pending_type: string | null;
  pending_id: string | null;
  sheet_used: boolean;
  drive_used: boolean;
  reminder_used: boolean;
  task_used: boolean;
  github_used: boolean;
  final_reply_summary: string | null;
  meta_json: unknown;
  created_at: Date;
};

function truncateUserMessage(s: string, max = 500): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export async function createRoutingTrace(
  db: Db,
  input: { channelUserId: string; inboundMessageId: number; userMessage: string }
): Promise<string | null> {
  try {
    const r = await db.query<{ trace_id: string }>(
      `INSERT INTO routing_traces (
         channel_user_id, inbound_message_id, user_message, route, reason
       ) VALUES ($1, $2, $3, 'started', 'message_received')
       RETURNING trace_id::text`,
      [input.channelUserId, input.inboundMessageId, truncateUserMessage(input.userMessage)]
    );
    return r.rows[0]?.trace_id ?? null;
  } catch (e) {
    getLogger().warn({ err: e }, "createRoutingTrace failed");
    return null;
  }
}

export async function updateRoutingTrace(db: Db, traceId: string, patch: RoutingTracePatch): Promise<void> {
  if (!traceId) return;
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = $${i}`);
    vals.push(v);
    i++;
  };
  if (patch.route != null) add("route", patch.route);
  if (patch.module_name !== undefined) add("module_name", patch.module_name);
  if (patch.intent !== undefined) add("intent", patch.intent);
  if (patch.confidence !== undefined) add("confidence", patch.confidence);
  if (patch.reason !== undefined) add("reason", patch.reason);
  if (patch.used_llm_fallback != null) add("used_llm_fallback", patch.used_llm_fallback);
  if (patch.used_growth_pipeline != null) add("used_growth_pipeline", patch.used_growth_pipeline);
  if (patch.used_improvement_capsule_candidate != null)
    add("used_improvement_capsule_candidate", patch.used_improvement_capsule_candidate);
  if (patch.used_pending != null) add("used_pending", patch.used_pending);
  if (patch.cleared_pending != null) add("cleared_pending", patch.cleared_pending);
  if (patch.pending_type !== undefined) add("pending_type", patch.pending_type);
  if (patch.pending_id !== undefined) add("pending_id", patch.pending_id);
  if (patch.sheet_used != null) add("sheet_used", patch.sheet_used);
  if (patch.drive_used != null) add("drive_used", patch.drive_used);
  if (patch.reminder_used != null) add("reminder_used", patch.reminder_used);
  if (patch.task_used != null) add("task_used", patch.task_used);
  if (patch.github_used != null) add("github_used", patch.github_used);
  if (patch.final_reply_summary !== undefined) add("final_reply_summary", patch.final_reply_summary);
  if (patch.meta_json != null) {
    sets.push(`meta_json = COALESCE(meta_json, '{}'::jsonb) || $${i}::jsonb`);
    vals.push(JSON.stringify(patch.meta_json));
    i++;
  }
  if (sets.length === 0) return;
  vals.push(traceId);
  try {
    await db.query(`UPDATE routing_traces SET ${sets.join(", ")} WHERE trace_id = $${i}::uuid`, vals);
  } catch (e) {
    getLogger().warn({ err: e, traceId }, "updateRoutingTrace failed");
  }
}

/** 現在の inbound より前に完了した直近の trace（デバッグ「直前の判定」用） */
export async function getLatestRoutingTraceBeforeInbound(
  db: Db,
  channelUserId: string,
  beforeInboundId: number
): Promise<RoutingTraceRow | null> {
  try {
    const r = await db.query<RoutingTraceRow>(
      `SELECT trace_id::text, channel_user_id, inbound_message_id::text, user_message, route, module_name,
              intent, confidence, reason,
              used_llm_fallback, used_growth_pipeline, used_improvement_capsule_candidate,
              used_pending, cleared_pending, pending_type, pending_id,
              sheet_used, drive_used, reminder_used, task_used, github_used,
              final_reply_summary, meta_json, created_at
       FROM routing_traces
       WHERE channel_user_id = $1 AND inbound_message_id < $2
       ORDER BY inbound_message_id DESC, created_at DESC
       LIMIT 1`,
      [channelUserId, beforeInboundId]
    );
    return r.rows[0] ?? null;
  } catch (e) {
    getLogger().warn({ err: e }, "getLatestRoutingTraceBeforeInbound failed");
    return null;
  }
}

export async function getRoutingTraceByInbound(
  db: Db,
  channelUserId: string,
  inboundMessageId: number
): Promise<RoutingTraceRow | null> {
  try {
    const r = await db.query<RoutingTraceRow>(
      `SELECT trace_id::text, channel_user_id, inbound_message_id::text, user_message, route, module_name,
              intent, confidence, reason,
              used_llm_fallback, used_growth_pipeline, used_improvement_capsule_candidate,
              used_pending, cleared_pending, pending_type, pending_id,
              sheet_used, drive_used, reminder_used, task_used, github_used,
              final_reply_summary, meta_json, created_at
       FROM routing_traces
       WHERE channel_user_id = $1 AND inbound_message_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [channelUserId, inboundMessageId]
    );
    return r.rows[0] ?? null;
  } catch (e) {
    getLogger().warn({ err: e }, "getRoutingTraceByInbound failed");
    return null;
  }
}
