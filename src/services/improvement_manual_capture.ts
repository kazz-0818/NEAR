/**
 * ワンクリック・手動の改善候補保存（即 Issue 化しない）
 */

import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import {
  buildConversationWindowForCandidate,
  insertImprovementCandidateManual,
  selectInboundLineMessageId,
} from "./improvement_capsule_repo.js";
import { getLatestRoutingTraceBeforeInbound } from "./routing_trace_service.js";
import type { OneClickImprovementKind } from "./routing_debug_command.js";
import { triggerReasonForOneClick } from "./routing_debug_command.js";

export async function saveOneClickImprovementCandidate(input: {
  db: Db;
  channelUserId: string;
  inboundMessageId: number;
  userText: string;
  kind: OneClickImprovementKind;
  priorNearReply: string;
  priorUserMessage?: string;
}): Promise<{ inserted: boolean }> {
  const env = getEnv();
  if (!env.NEAR_IMPROVEMENT_CAPSULES_ENABLED) return { inserted: false };

  const log = getLogger();
  const triggerReason = triggerReasonForOneClick(input.kind);
  const triggerMessageId = (await selectInboundLineMessageId(input.db, input.inboundMessageId)) ?? String(input.inboundMessageId);
  const prevTrace = await getLatestRoutingTraceBeforeInbound(input.db, input.channelUserId, input.inboundMessageId);
  const { turns } = await buildConversationWindowForCandidate(input.db, input.channelUserId, input.inboundMessageId, 10);

  const routeTaken = prevTrace?.route ?? "unknown";
  const moduleName = prevTrace?.module_name ?? null;

  const hint =
    input.kind === "manual_bad_reply"
      ? "直前の NEAR 返答が意図とずれている可能性"
      : input.kind === "manual_capsule"
        ? "会話全体を改善カプセル分析向けに記録"
        : "ルーティング／文脈の見直し候補";

  try {
    const r = await insertImprovementCandidateManual(input.db, {
      channelUserId: input.channelUserId,
      inboundMessageId: input.inboundMessageId,
      triggerMessageId,
      triggerReason,
      userMessage: input.userText,
      nearReply: input.priorNearReply.slice(0, 4000),
      parsed: null,
      routeTaken,
      moduleName,
      usedLlmFallback: prevTrace?.used_llm_fallback ?? false,
      usedGrowthPipeline: prevTrace?.used_growth_pipeline ?? false,
      conversationWindowJson: {
        turns,
        prior_user_message: input.priorUserMessage ?? null,
        hint,
      },
      routingTraceId: prevTrace?.trace_id ?? null,
      expectedRouteHint: hint,
    });
    if (r.inserted) {
      log.info({ inboundMessageId: input.inboundMessageId, triggerReason }, "manual improvement candidate saved");
    }
    return r;
  } catch (e) {
    log.warn({ err: e }, "saveOneClickImprovementCandidate failed");
    return { inserted: false };
  }
}

export async function saveUserRejectedRouteCandidate(input: {
  db: Db;
  channelUserId: string;
  inboundMessageId: number;
  userText: string;
  priorNearReply: string;
}): Promise<{ inserted: boolean }> {
  const env = getEnv();
  if (!env.NEAR_IMPROVEMENT_CAPSULES_ENABLED) return { inserted: false };

  const log = getLogger();
  const triggerReason = "user_rejected_route";
  const triggerMessageId = (await selectInboundLineMessageId(input.db, input.inboundMessageId)) ?? String(input.inboundMessageId);
  const prevTrace = await getLatestRoutingTraceBeforeInbound(input.db, input.channelUserId, input.inboundMessageId);
  const { turns } = await buildConversationWindowForCandidate(input.db, input.channelUserId, input.inboundMessageId, 10);

  try {
    const r = await insertImprovementCandidateManual(input.db, {
      channelUserId: input.channelUserId,
      inboundMessageId: input.inboundMessageId,
      triggerMessageId,
      triggerReason,
      userMessage: input.userText,
      nearReply: input.priorNearReply.slice(0, 4000),
      parsed: null,
      routeTaken: prevTrace?.route ?? "unknown",
      moduleName: prevTrace?.module_name ?? null,
      usedLlmFallback: prevTrace?.used_llm_fallback ?? false,
      usedGrowthPipeline: prevTrace?.used_growth_pipeline ?? false,
      conversationWindowJson: { turns, note: "Drive/Sheets ルート拒否" },
      routingTraceId: prevTrace?.trace_id ?? null,
      expectedRouteHint: "内部リマインド／タスク等の意図だった可能性",
    });
    if (r.inserted) log.info({ inboundMessageId: input.inboundMessageId }, "user_rejected_route candidate saved");
    return r;
  } catch (e) {
    log.warn({ err: e }, "saveUserRejectedRouteCandidate failed");
    return { inserted: false };
  }
}
