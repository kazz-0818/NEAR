import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import { looksLikeAgentSoftFailureReply } from "../lib/agentReplyHeuristics.js";
import { messageFingerprint } from "../lib/messageFingerprint.js";
import type { Db } from "../db/client.js";
import { insertGrowthCandidateSignalRow } from "../db/growth_candidate_signal_repo.js";
import { hasSignalSinceBucketKey, upsertGrowthSignalBucket } from "../db/growth_signal_bucket_repo.js";
import { recordFunnelStep } from "./growth_funnel_service.js";
import {
  computeSignalBucketKey,
  computeSignalPriorityScore,
} from "./growth_signal_model.js";
import type { ParsedIntent } from "../models/intent.js";
import type { AgentComposeSituation } from "../agent/composeSituation.js";

type RecordSignalResult = { insertedRaw: boolean; bucketId: number };

/**
 * バケット集約 + 任意の raw 行抑制。`user_message_fingerprint` はゲートと同じ `messageFingerprint(userText)`。
 */
async function recordGrowthCandidateSignalEntry(input: {
  db: Db;
  channel: string;
  channelUserId: string;
  inboundMessageId?: number | null;
  userText: string;
  source: string;
  reasonCode: string;
  detail?: Record<string, unknown>;
  parsedIntentSnapshot?: unknown;
  log: ReturnType<typeof getLogger>;
}): Promise<RecordSignalResult> {
  const env = getEnv();
  const channel = input.channel ?? "line";
  const bucketKey = computeSignalBucketKey(channel, input.userText, input.source, input.reasonCode);
  const userMessageFingerprint = messageFingerprint(input.userText);
  const priorityScore = computeSignalPriorityScore(input.source, input.reasonCode);

  const bucketId = await upsertGrowthSignalBucket(input.db, {
    bucketKey,
    userMessageFingerprint,
    channel,
    priorityScore,
    primarySource: input.source,
  });

  const hours = env.NEAR_GROWTH_SIGNAL_RAW_DEDUPE_HOURS;
  if (hours > 0) {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const recent = await hasSignalSinceBucketKey(input.db, bucketKey, since);
    if (recent) {
      try {
        await recordFunnelStep(input.db, {
          step: "growth_signal_raw_suppressed",
          inboundMessageId: input.inboundMessageId ?? null,
          channel,
          channelUserId: input.channelUserId,
          reasonCode: "raw_dedupe_within_window",
          detail: {
            bucket_id: bucketId,
            bucket_key: bucketKey,
            dedupe_hours: hours,
            source: input.source,
          },
        });
      } catch (e) {
        input.log.warn({ err: e }, "growth_signal_raw_suppressed funnel failed");
      }
      return { insertedRaw: false, bucketId };
    }
  }

  await insertGrowthCandidateSignalRow(input.db, {
    inboundMessageId: input.inboundMessageId,
    channel,
    channelUserId: input.channelUserId,
    source: input.source,
    reasonCode: input.reasonCode,
    detail: input.detail,
    parsedIntentSnapshot: input.parsedIntentSnapshot,
    bucketId,
    userMessageFingerprint,
    bucketKey,
    priorityScore,
  });
  return { insertedRaw: true, bucketId };
}

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
    await recordGrowthCandidateSignalEntry({
      db: input.db,
      channel: input.channel,
      channelUserId: input.channelUserId,
      inboundMessageId: input.inboundMessageId,
      userText: input.userText,
      source: "agent_path",
      reasonCode: reasons.join(","),
      detail: {
        composeSituation: input.composeSituation,
        toolsInvoked: input.toolsInvoked,
        agentSteps: input.agentSteps,
        textLen: input.finalText.length,
      },
      parsedIntentSnapshot: input.parsed,
      log,
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
    const { insertedRaw } = await recordGrowthCandidateSignalEntry({
      db: input.db,
      channel: input.channel,
      channelUserId: input.channelUserId,
      inboundMessageId: input.inboundMessageId,
      userText: input.userText,
      source: "faq_answerer",
      reasonCode: "draft_looks_like_capability_deflection",
      detail: {
        draft_preview: input.draft.slice(0, 400),
        user_preview: input.userText.slice(0, 200),
      },
      parsedIntentSnapshot: input.parsed,
      log,
    });
    await recordFunnelStep(input.db, {
      step: "faq_deflection_signal",
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      reasonCode: "capability_deflection_in_faq_draft",
      detail: { intent: input.parsed.intent, raw_row_inserted: insertedRaw },
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
  userText: string;
  parsed: ParsedIntent;
  situation: string;
}): Promise<void> {
  const env = getEnv();
  if (!env.NEAR_GROWTH_CANDIDATE_SIGNALS_ENABLED) return;
  if (input.situation !== "error") return;

  const log = getLogger();
  try {
    const { insertedRaw } = await recordGrowthCandidateSignalEntry({
      db: input.db,
      channel: input.channel,
      channelUserId: input.channelUserId,
      inboundMessageId: input.inboundMessageId,
      userText: input.userText,
      source: "legacy_module",
      reasonCode: "module_situation_error",
      detail: { intent: input.parsed.intent },
      parsedIntentSnapshot: input.parsed,
      log,
    });
    await recordFunnelStep(input.db, {
      step: "legacy_module_unresolved_signal",
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      reasonCode: "module_situation_error",
      detail: { intent: input.parsed.intent, raw_row_inserted: insertedRaw },
    });
  } catch (e) {
    log.warn({ err: e }, "insertGrowthCandidateSignal (legacy) failed");
  }
}
