import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import { looksLikeAgentSoftFailureReply } from "../lib/agentReplyHeuristics.js";
import { messageFingerprint } from "../lib/messageFingerprint.js";
import type { Db } from "../db/client.js";
import { insertGrowthCandidateSignalRow } from "../db/growth_candidate_signal_repo.js";
import { hasSignalSinceBucketKey, upsertGrowthSignalBucket } from "../db/growth_signal_bucket_repo.js";
import { recordFunnelStep } from "./growth_funnel_service.js";
import { maybePromoteGrowthBucketAfterSignal } from "./growth_promotion_service.js";
import { parsedIntentSchema } from "../models/intent.js";
import {
  computeSignalBucketKey,
  computeSignalPriorityScore,
} from "./growth_signal_model.js";
import type { ParsedIntent } from "../models/intent.js";
import type { AgentComposeSituation } from "../agent/composeSituation.js";

type RecordSignalResult = { insertedRaw: boolean; bucketId: number };

function resolveParsedForPromotion(snapshot: unknown, explicit?: ParsedIntent): ParsedIntent {
  if (explicit) return explicit;
  const pr = parsedIntentSchema.safeParse(snapshot);
  if (pr.success) return pr.data;
  return {
    intent: "unknown_custom_request",
    confidence: 0.4,
    can_handle: false,
    required_params: {},
    needs_followup: false,
    followup_question: null,
    reason: "growth_signal_snapshot_parse_fallback",
    suggested_category: null,
  };
}

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
  parsed?: ParsedIntent;
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
    lastUserText: input.userText,
    lastChannelUserId: input.channelUserId,
    lastInboundMessageId: input.inboundMessageId ?? null,
    lastParsedIntent: input.parsedIntentSnapshot ?? input.parsed,
  });

  const parsedResolved = resolveParsedForPromotion(input.parsedIntentSnapshot, input.parsed);
  if (input.inboundMessageId != null && input.inboundMessageId > 0) {
    try {
      await maybePromoteGrowthBucketAfterSignal(input.db, {
        bucketId,
        channel,
        channelUserId: input.channelUserId,
        inboundMessageId: input.inboundMessageId,
        userText: input.userText,
        parsed: parsedResolved,
        primarySource: input.source,
      });
    } catch (e) {
      input.log.warn({ err: e }, "maybePromoteGrowthBucketAfterSignal failed");
    }
  }

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
          growthSignalBucketId: bucketId,
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

  try {
    await recordFunnelStep(input.db, {
      step: "candidate_signal_recorded",
      inboundMessageId: input.inboundMessageId ?? null,
      channel,
      channelUserId: input.channelUserId,
      reasonCode: input.reasonCode,
      growthSignalBucketId: bucketId,
      detail: { source: input.source, bucket_key: bucketKey },
    });
  } catch (e) {
    input.log.warn({ err: e }, "candidate_signal_recorded funnel failed");
  }

  return { insertedRaw: true, bucketId };
}

/** runner が返すフォールバック文案の検出用 */
const AGENT_EMPTY_REPLY_HINT = "すみません、うまく言葉にできませんでした";
const AGENT_STEP_BUDGET_HINT = "処理が長引いたので";
const AGENT_LOOP_END_HINT = "いったんここまでにします";

/**
 * エージェント経路で返したが、エラー系・ソフト失敗・ツール未使用などのシグナルを残す。
 * agent early return 後も必ず評価される。
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
  const ft = input.finalText;
  if (input.composeSituation === "error") reasons.push("compose_error");
  if (looksLikeAgentSoftFailureReply(ft)) reasons.push("soft_failure_text");
  if (ft.includes(AGENT_EMPTY_REPLY_HINT)) reasons.push("agent_empty_or_fallback_reply");
  if (ft.includes(AGENT_STEP_BUDGET_HINT)) reasons.push("agent_step_budget_exhausted");
  if (ft.includes(AGENT_LOOP_END_HINT)) reasons.push("agent_max_steps_soft_stop");
  if (input.toolsInvoked.length === 0 && [...input.userText.normalize("NFKC")].length >= 15) {
    reasons.push("no_tools_invoked_long_user_message");
  }
  const uLen = [...input.userText.normalize("NFKC")].length;
  const fLen = ft.length;
  if (
    input.toolsInvoked.length === 0 &&
    uLen >= 20 &&
    fLen > 0 &&
    fLen < 120 &&
    !looksLikeAgentSoftFailureReply(ft)
  ) {
    reasons.push("ambiguous_short_reply_no_tools");
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
      reasonCode: [...new Set(reasons)].join(","),
      detail: {
        composeSituation: input.composeSituation,
        toolsInvoked: input.toolsInvoked,
        agentSteps: input.agentSteps,
        textLen: ft.length,
      },
      parsedIntentSnapshot: input.parsed,
      parsed: input.parsed,
      log,
    });
  } catch (e) {
    log.warn({ err: e }, "insertGrowthCandidateSignal (agent) failed");
  }
}

/** FAQ 返答が「準備中／未対応で断る」系か（成長シグナル用） */
export function looksLikeFaqCapabilityDeflectionDraft(draft: string): boolean {
  const t = draft.normalize("NFKC");
  return /準備中|まだお届け|直接お届け|お届けできません|いまのところ[^。]{0,40}できません|未対応です|機能はまだ|実装されていません|準備ができていません|この機能は|サポートしておりません|対応しておりません|情報は20\d{2}年\d{1,2}月[^。]{0,40}止まって|学習データ[^。]{0,40}最新[^。]{0,40}わから/i.test(
    t
  );
}

/**
 * simple_question（FAQ）が成功扱いでも、文案が能力否定・準備中止めなら成長候補シグナルに残す。
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
      parsed: input.parsed,
      log,
    });
    await recordFunnelStep(input.db, {
      step: "faq_deflection_signal",
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      reasonCode: "capability_deflection_in_faq_draft",
      growthSignalBucketId: undefined,
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
      parsed: input.parsed,
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

/**
 * 同一ユーザーの短時間での再発話（フォローアップの切迫さ）。
 */
export async function maybeRecordShortIntervalFollowupSignal(input: {
  db: Db;
  channel: string;
  channelUserId: string;
  inboundMessageId: number;
  userText: string;
  parsed: ParsedIntent;
  minutesSincePrevious: number;
}): Promise<void> {
  const env = getEnv();
  if (!env.NEAR_GROWTH_CANDIDATE_SIGNALS_ENABLED) return;
  if (env.NEAR_GROWTH_SHORT_FOLLOWUP_MINUTES <= 0) return;
  if (input.minutesSincePrevious > env.NEAR_GROWTH_SHORT_FOLLOWUP_MINUTES) return;

  const log = getLogger();
  try {
    await recordGrowthCandidateSignalEntry({
      db: input.db,
      channel: input.channel,
      channelUserId: input.channelUserId,
      inboundMessageId: input.inboundMessageId,
      userText: input.userText,
      source: "short_interval_followup",
      reasonCode: `repeat_within_${env.NEAR_GROWTH_SHORT_FOLLOWUP_MINUTES}m`,
      detail: {
        minutes_since_previous: input.minutesSincePrevious,
      },
      parsedIntentSnapshot: input.parsed,
      parsed: input.parsed,
      log,
    });
  } catch (e) {
    log.warn({ err: e }, "maybeRecordShortIntervalFollowupSignal failed");
  }
}
