import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import { looksLikeAgentSoftFailureReply } from "../lib/agentReplyHeuristics.js";
import type { Db } from "../db/client.js";
import { insertGrowthCandidateSignal } from "../db/growth_candidate_signal_repo.js";
import { recordFunnelStep } from "./growth_funnel_service.js";
import type { ParsedIntent } from "../models/intent.js";
import type { AgentComposeSituation } from "../agent/composeSituation.js";

/**
 * エージェント経路で返したが、エラー系・ソフト失敗・ツール未使用などのシグナルを残す。
 * unsupported には落ちないケースの観測用（成長候補の拡張入口）。
 */
export async function maybeRecordAgentPathGrowthSignals(input: {
  db: Db;
  channel: string;
  channelUserId: string;
  inboundMessageId: number;
  userText: string;
  parsed: ParsedIntent;
  finalText: string;
  composeSituation: AgentComposeSituation;
  toolsInvoked: string[];
  agentSteps: number;
}): Promise<void> {
  const env = getEnv();
  if (!env.NEAR_GROWTH_CANDIDATE_SIGNALS_ENABLED) return;

  const log = getLogger();
  const reasons: string[] = [];
  if (input.composeSituation === "error") reasons.push("compose_error");
  if (looksLikeAgentSoftFailureReply(input.finalText)) reasons.push("soft_failure_text");
  if (input.toolsInvoked.length === 0 && [...input.userText.normalize("NFKC")].length >= 15) {
    reasons.push("no_tools_invoked_long_user_message");
  }

  if (reasons.length === 0) return;

  try {
    await insertGrowthCandidateSignal(input.db, {
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      source: "agent_path",
      reasonCode: reasons.join(","),
      detail: {
        composeSituation: input.composeSituation,
        toolsInvoked: input.toolsInvoked,
        agentSteps: input.agentSteps,
        textLen: input.finalText.length,
      },
      parsedIntentSnapshot: input.parsed,
    });
  } catch (e) {
    log.warn({ err: e }, "insertGrowthCandidateSignal (agent) failed");
  }
}

/** FAQ 返答が「準備中／未対応で断る」系か（成長シグナル用） */
export function looksLikeFaqCapabilityDeflectionDraft(draft: string): boolean {
  const t = draft.normalize("NFKC");
  return /準備中|まだお届け|直接お届け|お届けできません|いまのところ[^。]{0,40}できません|未対応です|機能はまだ|実装されていません|準備ができていません|この機能は|サポートしておりません|対応しておりません/i.test(
    t
  );
}

/**
 * simple_question（FAQ）が成功扱いでも、文案が能力否定・準備中止めなら成長候補シグナルに残す。
 * unsupported には載らない経路の観測・拡張用。
 */
export async function maybeRecordFaqDeflectionGrowthSignal(input: {
  db: Db;
  channel: string;
  channelUserId: string;
  inboundMessageId: number;
  userText: string;
  parsed: ParsedIntent;
  draft: string;
}): Promise<void> {
  const env = getEnv();
  if (!env.NEAR_GROWTH_FAQ_DEFLECTION_SIGNAL_ENABLED) return;
  if (input.parsed.intent !== "simple_question") return;
  if (!looksLikeFaqCapabilityDeflectionDraft(input.draft)) return;

  const log = getLogger();
  try {
    await insertGrowthCandidateSignal(input.db, {
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      source: "faq_answerer",
      reasonCode: "draft_looks_like_capability_deflection",
      detail: {
        draft_preview: input.draft.slice(0, 400),
        user_preview: input.userText.slice(0, 200),
      },
      parsedIntentSnapshot: input.parsed,
    });
    await recordFunnelStep(input.db, {
      step: "faq_deflection_signal",
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      reasonCode: "capability_deflection_in_faq_draft",
      detail: { intent: input.parsed.intent },
    });
  } catch (e) {
    log.warn({ err: e }, "maybeRecordFaqDeflectionGrowthSignal failed");
  }
}

/** レガシーモジュールが error を返したが unsupported 分岐に入らなかった場合 */
export async function maybeRecordLegacyModuleErrorSignal(input: {
  db: Db;
  channel: string;
  channelUserId: string;
  inboundMessageId: number;
  parsed: ParsedIntent;
  situation: string;
}): Promise<void> {
  const env = getEnv();
  if (!env.NEAR_GROWTH_CANDIDATE_SIGNALS_ENABLED) return;
  if (input.situation !== "error") return;

  const log = getLogger();
  try {
    await insertGrowthCandidateSignal(input.db, {
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      source: "legacy_module",
      reasonCode: "module_situation_error",
      detail: { intent: input.parsed.intent },
      parsedIntentSnapshot: input.parsed,
    });
    await recordFunnelStep(input.db, {
      step: "legacy_module_unresolved_signal",
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      reasonCode: "module_situation_error",
      detail: { intent: input.parsed.intent },
    });
  } catch (e) {
    log.warn({ err: e }, "insertGrowthCandidateSignal (legacy) failed");
  }
}
