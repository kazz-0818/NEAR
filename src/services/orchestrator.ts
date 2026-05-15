import { getEnv } from "../config/env.js";
import type { Db } from "../db/client.js";
import { getHandler } from "../modules/registry.js";
import { logUnsupportedRequest } from "../modules/unsupported_request_logger.js";
import type { ParsedIntent } from "../models/intent.js";
import { classifyIntent } from "./intent_classifier.js";
import { sheetsReadIntegrationEnabled } from "../lib/userGoogleSheetsClient.js";
import { replyOrPush } from "../channels/line/client.js";
import { getLogger } from "../lib/logger.js";
import type { GrowthGateResult } from "./growth_suggestion_gate.js";
import { runGrowthPipelineAfterUnsupported } from "./growth_pipeline.js";
import {
  looksLikeFaqCapabilityDeflectionDraft,
  maybeRecordAgentPathGrowthSignals,
  maybeRecordFaqDeflectionGrowthSignal,
  maybeRecordLegacyModuleErrorSignal,
  maybeRecordShortIntervalFollowupSignal,
} from "./growth_candidate_signal_service.js";
import {
  getPreviousInboundMeta,
  loadQuotedAssistantMessage,
  loadRecentAssistantMessages,
  loadRecentUserMessages,
} from "./conversation_context.js";
import { resolveDisplayNameCacheOnly } from "../lib/lineUserProfile.js";
import { getUserRole } from "../db/user_roles_repo.js";
import { hasRole, insufficientRoleMessage, requiredRoleForIntent } from "../lib/permissions.js";
import {
  promoteGoogleSheetsFollowUp,
  promoteSheetsPendingAffirmative,
  promoteSheetsPendingPick,
} from "./sheetsIntentFollowUp.js";
import {
  assistantLastMessageSuggestsSheetsNeedMoreInfo,
  explicitUnanchoredSheetReadIntent,
  looksLikeSheetsThreadFollowUp,
  recentUserThreadHadSheetsTopic,
  roughSheetsBusinessRequest,
} from "./sheetsIntentPatterns.js";
import { saveOutboundAssistantText } from "./outbound_store.js";
import { interpretSecretaryRequest } from "./request_interpreter.js";
import { resolveLatestAssistantTextForEdit } from "./conversation_target_resolver.js";
import { editPreviousOutput } from "./previous_output_editor.js";
import { buildSecretaryClarificationReply } from "./secretary_clarification_handler.js";
import { syntheticIntentForSecretaryLayer } from "../models/requestInterpretation.js";
import { shouldInvokeNearAgent } from "../orchestrator/routingDecision.js";
import { runThinRouterPhase } from "../orchestrator/thinRouter.js";
import { runNearAgentTurn } from "../agent/runner.js";
import { composeNearReplyUnified } from "../agent/compose/nearComposer.js";
import { tryHandlePendingToolConfirmation } from "./pending_tool_confirm_handler.js";
import { tryHandlePendingClarification } from "./pending_clarification_handler.js";
import {
  looksLikeGrowthFeatureRequest,
  shouldTreatHandledIntentAsGrowthExtension,
} from "../lib/growthFeatureRequestHeuristics.js";
import {
  buildExternalCapabilityNeededReply,
  buildUnknownClarifyReply,
  classifyPreGrowthRequest,
  isStandaloneGithubIssueCreatePhrase,
} from "../lib/nearPreGrowthRouter.js";
import {
  isExplicitGrowthDevelopmentRequest,
  isForcedGrowthOrIssueCommand,
  isUserConfusionOrNegationSignal,
} from "../lib/growthExplicitRequest.js";
import { runLlmFallbackAnswer } from "./llm_fallback_answer.js";
import { recordImprovementCandidatesIfEligible } from "./improvement_capsule_record.js";
import type { ImprovementRoutingSnapshot } from "./improvement_capsule_rules.js";
import { createRoutingTrace, updateRoutingTrace } from "./routing_trace_service.js";
import type { UserRole } from "../db/user_roles_repo.js";

async function saveIntentRun(
  db: Db,
  inboundMessageId: number,
  parsed: ParsedIntent,
  rawOutput: unknown
): Promise<void> {
  const env = getEnv();
  await db.query(
    `INSERT INTO near_intent_runs (inbound_message_id, model, raw_output, parsed) VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
    [inboundMessageId, env.OPENAI_INTENT_MODEL, JSON.stringify(rawOutput), JSON.stringify(parsed)]
  );
}

async function replyLineAndRememberOutbound(
  db: Db,
  ctx: { channel: string; channelUserId: string; groupId?: string | null; inboundMessageId: number },
  replyToken: string,
  lineUserId: string,
  finalText: string,
  log: ReturnType<typeof getLogger>,
  capsuleSnap?: ImprovementRoutingSnapshot | null,
  routingTraceId?: string | null
): Promise<void> {
  const sent = await replyOrPush(replyToken, lineUserId, finalText);
  try {
    await saveOutboundAssistantText(db, {
      channel: ctx.channel,
      channelUserId: ctx.channelUserId,
      groupId: ctx.groupId ?? null,
      text: finalText,
      inboundMessageId: ctx.inboundMessageId,
      lineMessageId: sent.sentMessageIds[0] ?? null,
    });
  } catch (e) {
    log.warn({ err: e }, "saveOutboundAssistantText failed");
  }
  if (routingTraceId && capsuleSnap) {
    const sheetHint = /sheet|スプレッド|ガント|シート/i.test(capsuleSnap.routeTaken + (capsuleSnap.moduleName ?? ""));
    const driveHint = /drive|ドライブ|候補/i.test(capsuleSnap.routeTaken + (capsuleSnap.moduleName ?? ""));
    void updateRoutingTrace(db, routingTraceId, {
      route: capsuleSnap.routeTaken,
      module_name: capsuleSnap.moduleName,
      intent: capsuleSnap.parsed?.intent ?? null,
      confidence: capsuleSnap.parsed?.confidence ?? null,
      reason: capsuleSnap.parsed?.reason ?? null,
      used_llm_fallback: capsuleSnap.usedLlmFallback,
      used_growth_pipeline: capsuleSnap.usedGrowthPipeline,
      sheet_used: sheetHint,
      drive_used: driveHint,
      reminder_used: /reminder|リマインド/i.test(capsuleSnap.routeTaken + (capsuleSnap.moduleName ?? "")),
      task_used: /task|タスク/i.test(capsuleSnap.routeTaken + (capsuleSnap.moduleName ?? "")),
      github_used: /github|growth/i.test(capsuleSnap.routeTaken),
      final_reply_summary: finalText.slice(0, 400),
    }).catch((e) => log.warn({ err: e }, "updateRoutingTrace failed"));
  }
  if (capsuleSnap) {
    void recordImprovementCandidatesIfEligible({
      db,
      channelUserId: ctx.channelUserId,
      inboundMessageId: ctx.inboundMessageId,
      userText: capsuleSnap.userText,
      nearReply: finalText,
      snap: capsuleSnap,
    }).catch((e) => log.warn({ err: e }, "recordImprovementCandidatesIfEligible failed"));
  }
}

async function runNearAgentTurnWithTimeout(
  input: Parameters<typeof runNearAgentTurn>[0],
  timeoutMs: number
): Promise<Awaited<ReturnType<typeof runNearAgentTurn>>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`near agent timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    runNearAgentTurn(input)
      .then((r) => resolve(r))
      .catch((e) => reject(e))
      .finally(() => clearTimeout(timer));
  });
}

function looksLikeWeakFaqDraft(draft: string): boolean {
  const t = draft.normalize("NFKC").trim();
  if (!t) return true;
  if (looksLikeFaqCapabilityDeflectionDraft(t)) return true;
  if (t.length <= 32 && /(うまく|難しい|できません|わかりません|もう一度|短く)/i.test(t)) return true;
  return /(もう一度(短く)?送って|もう少し(具体的|詳しく)|お試しください|準備中|未対応|うまく言語化できませんでした)/i.test(t);
}

function looksLikeBroadConsultation(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (t.length < 4) return false;
  return /(考えて|提案|アイデア|戦略|施策|マーケ|マーケティング|改善|壁打ち|整理|比較|どうすれば|方針|企画|プラン|ロードマップ|優先順位|調べて|しらべて|リサーチ)/i.test(
    t
  );
}

function looksLikeBroadConsultationFollowup(text: string, recentUserMessages: string[]): boolean {
  const t = text.normalize("NFKC").trim();
  if (!/(調べて|しらべて|もっと詳しく|深掘り|続けて|つづき)/i.test(t)) return false;
  return recentUserMessages.slice(-6).some((m) => looksLikeBroadConsultation(m));
}

function looksLikeShortEntityReply(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (t.length === 0 || t.length > 48) return false;
  return /(です|だよ|です。|だよ。|です！|だよ！)$/.test(t) || /^[A-Za-z0-9][A-Za-z0-9 _-]{1,24}$/.test(t);
}

/** 挨拶・呼びかけのみ（直前が誤った確認文でも clarify で止めない） */
function looksLikeTrivialLinePing(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (t.length === 0 || t.length > 32) return false;
  return /^(にあ|ニア|ねあ|nea|near|こんにちは|こんばんは|おはよう|おーい|おつ|おつかれ|よう|はろー|hello|hi|やあ|やー)$/iu.test(
    t
  );
}

function buildBroadConsultationFallbackDraft(): string {
  return (
    "もちろんお手伝いできます。何を整理したいか、もう少し教えてもらえますか？\n" +
    "ゴール・対象・現状のどれかを一言添えてもらえると、すぐ動けます。"
  );
}

export async function handleLineTextMessage(input: {
  db: Db;
  replyToken: string;
  channelUserId: string;
  actorUserId?: string;
  groupId?: string;
  text: string;
  inboundMessageId: number;
  lineSourceType?: string;
}): Promise<void> {
  const log = getLogger();
  const { db, replyToken, channelUserId, actorUserId, groupId, text, inboundMessageId, lineSourceType } = input;

  // キャッシュのみ参照（LINE API を同期で呼ばない）。
  // 実際の取得は index.ts の fireAndForgetRefreshProfile が非同期で行う。
  const actorDisplayName = actorUserId
    ? (await resolveDisplayNameCacheOnly(db, actorUserId).catch(() => null)) ?? undefined
    : undefined;
  const channel = "line";
  const env = getEnv();
  // groupId をコンテキストに含め、返答保存時にも紐付ける
  const outboundCtx = { channel, channelUserId, groupId, inboundMessageId };
  const capSnap: ImprovementRoutingSnapshot = {
    userText: text,
    parsed: null,
    routeTaken: "unknown",
    moduleName: null,
    usedLlmFallback: false,
    usedGrowthPipeline: false,
    preGrowthCategory: null,
  };

  // 会話コンテキストを thinRouter より先に取得（タスク続き発言の判定に必要）
  // groupId スコープでフィルタリングして個人/グループの会話混在を防ぐ
  let recentUserMessages: string[] = [];
  let recentAssistantMessages: string[] = [];
  let quotedAssistantMessage: string | null = null;
  try {
    recentUserMessages = await loadRecentUserMessages(db, channel, channelUserId, inboundMessageId, {
      actorUserId: actorUserId ?? undefined,
      groupId: groupId ?? null,
    });
    recentAssistantMessages = await loadRecentAssistantMessages(db, channel, channelUserId, inboundMessageId, {
      groupId: groupId ?? null,
    });
    quotedAssistantMessage = await loadQuotedAssistantMessage(db, {
      inboundMessageId,
      channel,
      channelUserId,
      groupId: groupId ?? null,
    });
  } catch (ctxErr) {
    log.warn({ err: ctxErr }, "load recent conversation context failed; continuing without context");
  }

  let routingTraceId: string | null = null;
  try {
    routingTraceId = await createRoutingTrace(db, { channelUserId, inboundMessageId, userMessage: text });
  } catch (e) {
    log.warn({ err: e }, "createRoutingTrace failed");
  }
  const actorRole = await getUserRole(db, actorUserId ?? channelUserId).catch(() => "guest" as const);

  const thin = await runThinRouterPhase({
    db,
    env,
    channelUserId,
    actorUserId,
    groupId,
    text,
    inboundMessageId,
    lineSourceType,
    recentUserMessages,
    recentAssistantMessages,
    quotedAssistantMessage: quotedAssistantMessage ?? undefined,
    actorRole,
  });
  if (thin.handled) {
    capSnap.parsed = null;
    capSnap.routeTaken = thin.routingTracePatch?.route ?? "thin_router";
    capSnap.moduleName = thin.routingTracePatch?.module_name ?? null;
    capSnap.usedLlmFallback = thin.routingTracePatch?.used_llm_fallback ?? false;
    capSnap.usedGrowthPipeline = thin.routingTracePatch?.used_growth_pipeline ?? false;
    capSnap.preGrowthCategory = null;
    if (routingTraceId && thin.routingTracePatch) {
      void updateRoutingTrace(db, routingTraceId, thin.routingTracePatch).catch((e) =>
        log.warn({ err: e }, "merge thin routingTracePatch failed")
      );
    }
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, thin.finalText, log, capSnap, routingTraceId);
    return;
  }
  if (routingTraceId && thin.routingTracePatch) {
    void updateRoutingTrace(db, routingTraceId, thin.routingTracePatch).catch((e) =>
      log.warn({ err: e }, "merge thin routingTracePatch (unhandled) failed")
    );
  }

  // thinRouter から強制 intent が返った場合は secretary 層・intent 分類をスキップして直接処理する
  let thinForceIntent = !thin.handled ? thin.forceIntent : undefined;
  let thinForceRequiredParams = !thin.handled ? thin.forceRequiredParams : undefined;

  // ----------------------------------------------------------------
  // Growth 明示要望・混乱シグナルの判定
  // これより下の pending 系・Sheets 昇格をバイパスするためにここで計算する
  // ----------------------------------------------------------------
  const isExplicitGrowth = isExplicitGrowthDevelopmentRequest(text) || isForcedGrowthOrIssueCommand(text);
  const isConfusion = isUserConfusionOrNegationSignal(text);

  // pending clarification は Growth 要望・混乱シグナルでスキップ
  if (!isExplicitGrowth && !isConfusion) {
    const pendingClarification = await tryHandlePendingClarification({
      db,
      channel,
      channelUserId,
      actorUserId,
      groupId,
      text,
    });
    if (pendingClarification.handled) {
      capSnap.routeTaken = "pending_clarification";
      capSnap.moduleName = null;
      capSnap.usedLlmFallback = false;
      capSnap.usedGrowthPipeline = false;
      capSnap.preGrowthCategory = null;
      await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, pendingClarification.finalText, log, capSnap, routingTraceId);
      return;
    }
    if ("forceIntent" in pendingClarification && pendingClarification.forceIntent) {
      thinForceIntent = pendingClarification.forceIntent;
      thinForceRequiredParams = pendingClarification.forceRequiredParams;
    }
  } else {
    log.info({ isExplicitGrowth, isConfusion }, "skipping pending_clarification: growth request or confusion signal");
  }

  // pending tool confirmation は Growth 要望・混乱シグナルでスキップ
  if (!isExplicitGrowth && !isConfusion) {
    const pendingHit = await tryHandlePendingToolConfirmation({
      db,
      channel,
      channelUserId,
      text,
      inboundMessageId,
      recentUserMessages,
      recentAssistantMessages,
    });
    if (pendingHit.handled && pendingHit.finalText != null) {
      capSnap.routeTaken = "pending_tool_confirmation";
      capSnap.moduleName = null;
      capSnap.usedLlmFallback = false;
      capSnap.usedGrowthPipeline = false;
      capSnap.preGrowthCategory = null;
      await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, pendingHit.finalText, log, capSnap, routingTraceId);
      return;
    }
  } else {
    log.info({ isExplicitGrowth, isConfusion }, "skipping pending_tool_confirmation: growth request or confusion signal");
  }

  if (!env.NEAR_SECRETARY_LAYER_DISABLED && !thinForceIntent) {
    try {
      const interpretation = await interpretSecretaryRequest({
        userText: text,
        recentUserMessages,
        recentAssistantMessages,
      });

      if (interpretation.mode === "edit_previous_output" && interpretation.confidence >= 0.48) {
        const target = resolveLatestAssistantTextForEdit(recentAssistantMessages);
        if (target) {
          try {
            const edited = await editPreviousOutput({
              targetText: target,
              instruction: text,
              recentUserMessages,
            });
            let finalText = edited;
            try {
              finalText = await composeNearReplyUnified({ actorDisplayName,
                draft: edited,
                situation: "success",
                userMessage: text,
                recentUserMessages,
                recentAssistantMessages,
              });
            } catch (ce) {
              log.warn({ err: ce }, "composeNearReplyUnified failed (secretary edit path)");
            }
            await saveIntentRun(db, inboundMessageId, syntheticIntentForSecretaryLayer("edit_previous_output", interpretation.confidence), {
              secretary_interpretation: interpretation,
              shortcut: "edit_previous_output",
            });
            capSnap.routeTaken = "secretary_edit_previous_output";
            capSnap.moduleName = null;
            capSnap.usedLlmFallback = false;
            capSnap.usedGrowthPipeline = false;
            capSnap.preGrowthCategory = null;
            await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
            return;
          } catch (e) {
            log.warn({ err: e }, "secretary edit_previous_output failed; continuing to intent routing");
          }
        }
      }

      if (interpretation.mode === "clarify_missing_info" && interpretation.confidence >= 0.65) {
        if (looksLikeGrowthFeatureRequest(text)) {
          log.info({ mode: interpretation.mode }, "secretary clarify skipped: growth-feature-like request");
        } else if (isConfusion) {
          // 混乱・フラストレーションシグナルは clarify を出さず LLM に渡す
          log.info({ mode: interpretation.mode }, "secretary clarify skipped: user confusion signal — let LLM handle naturally");
        } else if (looksLikeTrivialLinePing(text)) {
          log.info({ mode: interpretation.mode }, "secretary clarify skipped: trivial ping / greeting");
        } else if (
          recentAssistantMessages.length > 0 &&
          /^(これ|それ|あれ|この|その|あの)(は|が|を|に|で|の|って|どういう|どゆ|何|なに|どう)/u.test(text.trim())
        ) {
          // 「これどういう意味？」「それって何？」など、指示詞で直前発言を参照している場合
          // clarify せず LLM に文脈ごと渡す
          log.info({ mode: interpretation.mode }, "secretary clarify skipped: deictic reference to recent assistant output");
        } else {
        const shouldSkipClarifyForConsultation =
          looksLikeBroadConsultation(text) ||
          looksLikeBroadConsultationFollowup(text, recentUserMessages) ||
          (looksLikeShortEntityReply(text) && recentUserMessages.slice(-6).some((m) => looksLikeBroadConsultation(m)));
        if (shouldSkipClarifyForConsultation) {
          log.info({ mode: interpretation.mode }, "secretary clarify skipped: prefer direct broad consultation answer");
        } else if (
          recentAssistantMessages.length > 0 &&
          assistantLastMessageSuggestsSheetsNeedMoreInfo(recentAssistantMessages) &&
          (recentUserThreadHadSheetsTopic(recentUserMessages) || roughSheetsBusinessRequest(text)) &&
          text.trim().length <= 48
        ) {
          log.info(
            { mode: interpretation.mode },
            "secretary clarify skipped: short reply after sheets-target prompt"
          );
        } else if (
          looksLikeSheetsThreadFollowUp(text, recentUserMessages) ||
          explicitUnanchoredSheetReadIntent(text, recentUserMessages)
        ) {
          log.info(
            {
              mode: interpretation.mode,
              sheetsReadIntegrationEnabled: sheetsReadIntegrationEnabled(),
            },
            "secretary clarify skipped: sheet read / drive search routing likely"
          );
        } else if (
          interpretation.confidence < 0.75 &&
          recentAssistantMessages.length > 0 &&
          text.trim().length <= 20
        ) {
          // 短文かつ直前の会話がある場合は続き発言と判断して clarify を抑制
          log.info({ mode: interpretation.mode, confidence: interpretation.confidence }, "secretary clarify skipped: short followup likely");
        } else {
          try {
            const clarifyDraft = await buildSecretaryClarificationReply({
              userMessage: text,
              recentUserMessages,
              recentAssistantMessages,
            });
            let finalText = clarifyDraft;
            try {
              finalText = await composeNearReplyUnified({ actorDisplayName,
                draft: clarifyDraft,
                situation: "followup",
                userMessage: text,
                recentUserMessages,
                recentAssistantMessages,
              });
            } catch (ce) {
              log.warn({ err: ce }, "composeNearReplyUnified failed (secretary clarify path)");
            }
            await saveIntentRun(db, inboundMessageId, syntheticIntentForSecretaryLayer("clarify_missing_info", interpretation.confidence), {
              secretary_interpretation: interpretation,
              shortcut: "clarify_missing_info",
            });
            capSnap.routeTaken = "secretary_clarify_missing_info";
            capSnap.moduleName = null;
            capSnap.usedLlmFallback = false;
            capSnap.usedGrowthPipeline = false;
            capSnap.preGrowthCategory = null;
            await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
            return;
          } catch (e) {
            log.warn({ err: e }, "secretary clarify_missing_info failed; continuing to intent routing");
          }
        }
        }
      }
    } catch (e) {
      log.warn({ err: e }, "secretary layer error; continuing to intent routing");
    }
  }

  let parsed: ParsedIntent;
  if (thinForceIntent) {
    // thinRouter が強制指定した intent（secretary 層・LLM 分類スキップ）
    log.info({ forceIntent: thinForceIntent }, "using thinRouter forceIntent");
    parsed = {
      intent: thinForceIntent as ParsedIntent["intent"],
      confidence: 1,
      can_handle: true,
      required_params: thinForceRequiredParams ?? {},
      needs_followup: false,
      followup_question: null,
      reason: "thinRouter_force",
      suggested_category: null,
    };
  } else {
    try {
      parsed = await classifyIntent(text, { recentUserMessages, recentAssistantMessages });
    } catch (e) {
      log.error({ err: e }, "classifyIntent threw");
      parsed = {
        intent: "unknown_custom_request",
        confidence: 0,
        can_handle: false,
        required_params: {},
        needs_followup: false,
        followup_question: null,
        reason: "分類エラー",
        suggested_category: "システム安定化",
      };
    }
  }

  // ----------------------------------------------------------------
  // Growth 明示要望: LLM が reminder_request に誤分類したケースのみ上書きする
  // 他の intent（simple_question 等）は LLM の判断を尊重する（LLMよりに寄せる）
  // reminder_request への誤分類は「実際にリマインダーが作られる」危険があるため必須
  // 注: google_sheets_query / task_create / google_calendar_query は
  //     EXTENSION_OVERRIDE_INTENTS（shouldTreatHandledIntentAsGrowthExtension）が守る
  // ----------------------------------------------------------------
  if (isExplicitGrowth && parsed.intent === "reminder_request") {
    log.info(
      { classifiedIntent: parsed.intent, text },
      "growth_explicit_override: reminder_request → unknown_custom_request (prevent accidental reminder)"
    );
    parsed = {
      ...parsed,
      intent: "unknown_custom_request",
      can_handle: false,
      needs_followup: false,
      followup_question: null,
      reason: `growth_explicit_override:was_${parsed.intent}`,
      suggested_category: parsed.suggested_category ?? "機能追加",
    };
  }

  // Growth 明示要望・混乱シグナルは Sheets 昇格をすべてスキップ（misroute 防止）
  if (!isExplicitGrowth && !isConfusion) {
    try {
      parsed = await promoteSheetsPendingPick(text, parsed, db, channelUserId);
      parsed = await promoteSheetsPendingAffirmative(text, parsed, db, channelUserId);
      parsed = await promoteGoogleSheetsFollowUp(text, parsed, recentUserMessages, db, channelUserId);
    } catch (promoErr) {
      log.warn({ err: promoErr }, "promoteGoogleSheetsFollowUp failed; using classifyIntent result");
    }
  } else {
    log.info({ isExplicitGrowth, isConfusion }, "skipping Sheets promotion: growth request or confusion signal");
  }

  // 会話途中（直前の NEAR 発言がある）で greeting に分類されたら simple_question に救済する。
  // 「お願いします」「ありがとう」などが greeting に誤分類されて挨拶返しするのを防ぐ。
  if (
    parsed.intent === "greeting" &&
    recentAssistantMessages.length > 0 &&
    !/(こんにちは|おはよう|こんばんは|はじめまして|久しぶり|久しぶりです|初めまして|お元気|よろしく(お願い)?[いし]?[まい]?す)/iu.test(text)
  ) {
    log.info({ text }, "orchestrator_mid_conversation_greeting_rescue: → simple_question");
    parsed = {
      ...parsed,
      intent: "simple_question",
      can_handle: true,
      needs_followup: false,
      followup_question: null,
      reason: "orchestrator_mid_conversation_greeting_rescue",
      suggested_category: null,
    };
  }

  // 「何ができる」「使い方」系が unknown に落ちたら help_capabilities へ救済する
  if (
    parsed.intent === "unknown_custom_request" &&
    /何ができ|できること|使い方|ヘルプ|help|何ができますか|何を手伝|何が使え|機能一覧|機能は何/iu.test(text.normalize("NFKC"))
  ) {
    parsed = {
      ...parsed,
      intent: "help_capabilities",
      can_handle: true,
      needs_followup: false,
      followup_question: null,
      reason: "orchestrator_help_capabilities_rescue",
      suggested_category: null,
    };
  }

  // GPT寄り運用: 一般相談が unknown に落ちたら simple_question へ救済して会話で巻き取る。
  if (
    parsed.intent === "unknown_custom_request" &&
    looksLikeBroadConsultation(text) &&
    !looksLikeGrowthFeatureRequest(text)
  ) {
    parsed = {
      ...parsed,
      intent: "simple_question",
      can_handle: true,
      needs_followup: false,
      followup_question: null,
      reason: "orchestrator_broad_consultation_rescue",
      suggested_category: null,
    };
  }
  if (
    parsed.intent === "unknown_custom_request" &&
    looksLikeShortEntityReply(text) &&
    recentUserMessages.slice(-6).some((m) => looksLikeBroadConsultation(m)) &&
    !looksLikeGrowthFeatureRequest(text)
  ) {
    parsed = {
      ...parsed,
      intent: "simple_question",
      can_handle: true,
      needs_followup: false,
      followup_question: null,
      reason: "orchestrator_broad_consultation_entity_followup_rescue",
      suggested_category: null,
    };
  }

  // 直前に会話があり、かつ短い発言（30文字以下）は続き発言として simple_question に昇格
  // （タスク・シート・権限などの専用モジュールを通過した後のフォールバック）
  if (
    parsed.intent === "unknown_custom_request" &&
    recentAssistantMessages.length > 0 &&
    text.trim().length <= 30 &&
    !/https?:\/\//i.test(text) &&
    !looksLikeGrowthFeatureRequest(text)
  ) {
    parsed = {
      ...parsed,
      intent: "simple_question",
      can_handle: true,
      needs_followup: false,
      followup_question: null,
      reason: "orchestrator_short_followup_rescue",
      suggested_category: null,
    };
  }

  await saveIntentRun(db, inboundMessageId, parsed, {
    ok: true,
    routing_meta: { phase: "post_promote" },
  });
  capSnap.parsed = parsed;

  if (env.NEAR_GROWTH_SHORT_FOLLOWUP_MINUTES > 0 && env.NEAR_GROWTH_CANDIDATE_SIGNALS_ENABLED) {
    try {
      const prev = await getPreviousInboundMeta(db, channel, channelUserId, inboundMessageId);
      if (prev) {
        const mins = (Date.now() - prev.created_at.getTime()) / 60000;
        if (mins >= 0 && mins <= env.NEAR_GROWTH_SHORT_FOLLOWUP_MINUTES) {
          await maybeRecordShortIntervalFollowupSignal({
            db,
            channel,
            channelUserId,
            inboundMessageId,
            userText: text,
            parsed,
            minutesSincePrevious: mins,
          });
        }
      }
    } catch (se) {
      log.warn({ err: se }, "short interval followup signal failed");
    }
  }

  // 権限チェック（actorRole は handleLineTextMessage 冒頭で取得済み）
  const requiredRole = requiredRoleForIntent(parsed.intent);
  if (!hasRole(actorRole, requiredRole)) {
    // 【動作確認】restricted（制限ユーザー）には冷たく一言だけ返す
    const RESTRICTED_DENY_REPLIES = [
      "知らん。",
      "。",
      "は？",
      "ふーん。",
      "そう。",
      "…。",
      "どうぞ（無視）。",
    ];
    const denyText = actorRole === "restricted"
      ? RESTRICTED_DENY_REPLIES[Math.floor(Math.random() * RESTRICTED_DENY_REPLIES.length)]!
      : insufficientRoleMessage(requiredRole);
    capSnap.routeTaken = "insufficient_role";
    capSnap.moduleName = parsed.intent;
    capSnap.usedLlmFallback = false;
    capSnap.usedGrowthPipeline = false;
    capSnap.preGrowthCategory = null;
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, denyText, log, capSnap, routingTraceId);
    return;
  }

  const handler = getHandler(parsed.intent);
  const routable =
    parsed.can_handle === true && parsed.intent !== "unknown_custom_request" && handler !== undefined;

  if (routable && shouldTreatHandledIntentAsGrowthExtension(text, parsed.intent)) {
    const growthParsed: ParsedIntent = {
      ...parsed,
      intent: "unknown_custom_request",
      can_handle: false,
      needs_followup: false,
      followup_question: null,
      reason: `growth_v3_handled_intent_extension:${parsed.intent}`,
      suggested_category: parsed.suggested_category ?? "機能拡張",
    };
    const unsupportedId = await logUnsupportedRequest({
      db,
      channel,
      channelUserId,
      originalMessage: text,
      intent: growthParsed,
      inboundMessageId,
      whyOverride: `拡張要望として記録（分類は ${parsed.intent}）`,
      routingCategory: "growth_candidate",
    });
    const gate = await runGrowthPipelineAfterUnsupported(db, log, {
      unsupportedId,
      inboundMessageId,
      channel,
      channelUserId,
      text,
      parsed: growthParsed,
    });
    const draftBase =
      "そのお願いは、いまの私の定型機能だけではまだカバーしきれていません。内容は控えとして残し、近いうちに手が届くよう整えていきます。言い換えや、いま手伝える範囲に寄せた相談でも大丈夫です。";
    let draft = draftBase;
    if (env.NEAR_GROWTH_USER_ACK_ENABLED && gate.allow) {
      draft = `${draftBase}\n\n※ このご要望は、成長候補として記録し、開発側で検討できるよう控えました。`;
    }
    let finalText = draft;
    try {
      finalText = await composeNearReplyUnified({
        actorDisplayName,
        draft,
        situation: "unsupported",
        userMessage: text,
        recentUserMessages,
        recentAssistantMessages,
      });
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReplyUnified failed (growth extension path)");
    }
    capSnap.routeTaken = "growth_handled_intent_extension";
    capSnap.moduleName = parsed.intent;
    capSnap.usedLlmFallback = false;
    capSnap.usedGrowthPipeline = true;
    capSnap.preGrowthCategory = "growth_explicit";
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
    return;
  }

  if (shouldInvokeNearAgent(env, parsed.intent, routable, text)) {
    try {
      const agentResult = await runNearAgentTurnWithTimeout(
        {
        db,
        channel,
        channelUserId,
        groupId,
        actorUserId,
        actorDisplayName,
        inboundMessageId,
        userText: text,
        recentUserMessages,
        recentAssistantMessages,
      },
        env.NEAR_AGENT_TIMEOUT_MS
      );
      const trimmed = agentResult.text.trim();
      if (trimmed) {
        log.info(
          {
            inboundMessageId,
            agentSteps: agentResult.log.steps,
            agentTools: agentResult.log.toolsInvoked,
            agentModel: agentResult.log.model,
          },
          "near agent path replied"
        );
        let finalText = trimmed;
        if (!env.NEAR_AGENT_SKIP_COMPOSE) {
          try {
            finalText = await composeNearReplyUnified({ actorDisplayName,
              draft: trimmed,
              situation: agentResult.composeSituation,
              userMessage: text,
              recentUserMessages,
              recentAssistantMessages,
            });
          } catch (ce) {
            log.warn({ err: ce }, "composeNearReplyUnified failed (near agent path)");
          }
        }
        capSnap.routeTaken = "agent";
        capSnap.moduleName = null;
        capSnap.usedLlmFallback = false;
        capSnap.usedGrowthPipeline = false;
        capSnap.preGrowthCategory = null;
        await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
        await maybeRecordAgentPathGrowthSignals({
          db,
          channel,
          channelUserId,
          inboundMessageId,
          userText: text,
          parsed,
          finalText,
          composeSituation: agentResult.composeSituation,
          toolsInvoked: agentResult.log.toolsInvoked,
          agentSteps: agentResult.log.steps,
        });
        return;
      }
    } catch (e) {
      log.error({ err: e }, "near agent failed; continuing with legacy routing");
    }
  }

  try {
    // !routable: AI-first（pre-growth）— Growth は明示的システム依頼のみ先取り。それ以外は LLM → 失敗時のみ Growth ヒューリスティクス等。
    if (!routable) {
      const whyUnsupported =
        parsed.intent === "unknown_custom_request"
          ? "該当処理モジュールなし"
          : !parsed.can_handle
            ? parsed.reason ?? "can_handle が false"
            : "ハンドラ未登録";

      const preGrowth = classifyPreGrowthRequest(text, parsed);

      if (preGrowth.category === "growth_explicit" && preGrowth.allowGrowth) {
        const unsupportedId = await logUnsupportedRequest({
          db,
          channel,
          channelUserId,
          originalMessage: text,
          intent: parsed,
          inboundMessageId,
          whyOverride: `${whyUnsupported}（成長候補扱い）`,
          routingCategory: "growth_candidate",
        });

        const gate = await runGrowthPipelineAfterUnsupported(db, log, {
          unsupportedId,
          inboundMessageId,
          channel,
          channelUserId,
          text,
          parsed,
        });

        const draftBase =
          "そのお願いは、いまの私の定型機能だけではまだカバーしきれていません。内容は控えとして残し、近いうちに手が届くよう整えていきます。言い換えや、いま手伝える範囲に寄せた相談でも大丈夫です。";
        let draft = draftBase;
        if (env.NEAR_GROWTH_USER_ACK_ENABLED && gate.allow) {
          draft = `${draftBase}\n\n※ このご要望は、成長候補として記録し、開発側で検討できるよう控えました。`;
        }
        let finalText = draft;
        try {
          finalText = await composeNearReplyUnified({
            actorDisplayName,
            draft,
            situation: "unsupported",
            userMessage: text,
            recentUserMessages,
            recentAssistantMessages,
          });
        } catch (ce) {
          log.warn({ err: ce }, "composeNearReplyUnified failed (unsupported growth path)");
        }
        capSnap.routeTaken = "growth_pre_router_explicit";
        capSnap.moduleName = null;
        capSnap.usedLlmFallback = false;
        capSnap.usedGrowthPipeline = true;
        capSnap.preGrowthCategory = preGrowth.category;
        await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
        return;
      }

      if (preGrowth.category === "external_realtime_answer" && preGrowth.useShortExternalReply) {
        await logUnsupportedRequest({
          db,
          channel,
          channelUserId,
          originalMessage: text,
          intent: parsed,
          inboundMessageId,
          whyOverride: "リアルタイム外部データ取得が必要（NEAR未実装）",
          routingCategory: "external_tool_needed",
        });
        const extDraft = buildExternalCapabilityNeededReply();
        let finalText = extDraft;
        try {
          finalText = await composeNearReplyUnified({
            actorDisplayName,
            draft: extDraft,
            situation: "success",
            userMessage: text,
            recentUserMessages,
            recentAssistantMessages,
          });
        } catch (ce) {
          log.warn({ err: ce }, "composeNearReplyUnified failed (external tool needed path)");
        }
        capSnap.routeTaken = "external_tool_short_reply";
        capSnap.moduleName = null;
        capSnap.usedLlmFallback = false;
        capSnap.usedGrowthPipeline = false;
        capSnap.preGrowthCategory = preGrowth.category;
        await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
        return;
      }

      if (preGrowth.preferLlmFallback) {
        try {
          const fb = await runLlmFallbackAnswer({
            userText: text,
            recentUserMessages,
            recentAssistantMessages,
          });
          let finalText = fb.draft;
          try {
            finalText = await composeNearReplyUnified({
              actorDisplayName,
              draft: fb.draft,
              situation: "success",
              userMessage: text,
              recentUserMessages,
              recentAssistantMessages,
            });
          } catch (ce) {
            log.warn({ err: ce }, "composeNearReplyUnified failed (llm fallback path)");
          }
          capSnap.routeTaken = "llm_fallback";
          capSnap.moduleName = null;
          capSnap.usedLlmFallback = true;
          capSnap.usedGrowthPipeline = false;
          capSnap.preGrowthCategory = preGrowth.category;
          await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
          return;
        } catch (fe) {
          log.warn({ err: fe }, "llm fallback path failed; falling back to growth or clarify");
        }
      }

      if (looksLikeGrowthFeatureRequest(text) && !isStandaloneGithubIssueCreatePhrase(text)) {
        const unsupportedId = await logUnsupportedRequest({
          db,
          channel,
          channelUserId,
          originalMessage: text,
          intent: parsed,
          inboundMessageId,
          whyOverride: `${whyUnsupported}（LLM失敗後・成長候補扱い）`,
          routingCategory: "growth_candidate",
        });

        const gate = await runGrowthPipelineAfterUnsupported(db, log, {
          unsupportedId,
          inboundMessageId,
          channel,
          channelUserId,
          text,
          parsed,
        });

        const draftBase =
          "そのお願いは、いまの私の定型機能だけではまだカバーしきれていません。内容は控えとして残し、近いうちに手が届くよう整えていきます。言い換えや、いま手伝える範囲に寄せた相談でも大丈夫です。";
        let draft = draftBase;
        if (env.NEAR_GROWTH_USER_ACK_ENABLED && gate.allow) {
          draft = `${draftBase}\n\n※ このご要望は、成長候補として記録し、開発側で検討できるよう控えました。`;
        }
        let finalText = draft;
        try {
          finalText = await composeNearReplyUnified({
            actorDisplayName,
            draft,
            situation: "unsupported",
            userMessage: text,
            recentUserMessages,
            recentAssistantMessages,
          });
        } catch (ce) {
          log.warn({ err: ce }, "composeNearReplyUnified failed (post-llm growth path)");
        }
        capSnap.routeTaken = "growth_after_llm_failure";
        capSnap.moduleName = null;
        capSnap.usedLlmFallback = true;
        capSnap.usedGrowthPipeline = true;
        capSnap.preGrowthCategory = preGrowth.category;
        await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
        return;
      }

      const unsupportedId = await logUnsupportedRequest({
        db,
        channel,
        channelUserId,
        originalMessage: text,
        intent: parsed,
        inboundMessageId,
        whyOverride: `${whyUnsupported}（意図確認）`,
        routingCategory: "unsupported_unknown",
      });

      await runGrowthPipelineAfterUnsupported(db, log, {
        unsupportedId,
        inboundMessageId,
        channel,
        channelUserId,
        text,
        parsed,
      });

      const draft = buildUnknownClarifyReply();
      let finalText = draft;
      try {
        finalText = await composeNearReplyUnified({
          actorDisplayName,
          draft,
          situation: "followup",
          userMessage: text,
          recentUserMessages,
          recentAssistantMessages,
        });
      } catch (ce) {
        log.warn({ err: ce }, "composeNearReplyUnified failed (unknown clarify path)");
      }
      capSnap.routeTaken = "unknown_clarify_with_growth_signal";
      capSnap.moduleName = null;
      capSnap.usedLlmFallback = false;
      capSnap.usedGrowthPipeline = true;
      capSnap.preGrowthCategory = preGrowth.category;
      await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
      return;
    }

    const modResult = await handler!({
      db,
      channel,
      channelUserId,
      groupId,
      actorUserId,
      actorDisplayName,
      intent: parsed,
      originalText: text,
      inboundMessageId,
      recentUserMessages,
      recentAssistantMessages,
    });

    const situation =
      modResult.situation === "unsupported"
        ? "unsupported"
        : modResult.situation === "error"
          ? "error"
          : modResult.situation === "followup"
            ? "followup"
            : "success";

    let growthGateForAck: GrowthGateResult | null = null;
    if (!modResult.success && situation === "unsupported") {
      const unsupportedId = await logUnsupportedRequest({
        db,
        channel,
        channelUserId,
        originalMessage: text,
        intent: parsed,
        inboundMessageId,
        whyOverride: "モジュールが未対応と判断",
        routingCategory: "existing_module_failed",
      });
      growthGateForAck = await runGrowthPipelineAfterUnsupported(db, log, {
        unsupportedId,
        inboundMessageId,
        channel,
        channelUserId,
        text,
        parsed,
      });
    } else if (situation === "error") {
      await maybeRecordLegacyModuleErrorSignal({
        db,
        channel,
        channelUserId,
        inboundMessageId,
        userText: text,
        parsed,
        situation,
      });
    }

    const faqDeflectionDetected =
      modResult.success &&
      situation === "success" &&
      parsed.intent === "simple_question" &&
      looksLikeFaqCapabilityDeflectionDraft(modResult.draft);
    const faqWeakDetected =
      modResult.success &&
      situation === "success" &&
      parsed.intent === "simple_question" &&
      looksLikeWeakFaqDraft(modResult.draft);
    const shouldRetryFaqViaAgent =
      env.NEAR_AGENT_ENABLED &&
      ((faqDeflectionDetected && env.NEAR_AGENT_RETRY_ON_FAQ_DEFLECTION) ||
        (faqWeakDetected && env.NEAR_AGENT_RETRY_ON_WEAK_FAQ));

    let faqRetryFallbackDraft: string | null = null;
    if (shouldRetryFaqViaAgent) {
      try {
        const agentRetry = await runNearAgentTurnWithTimeout(
          {
          db,
          channel,
          channelUserId,
          groupId,
          actorUserId,
          actorDisplayName,
          inboundMessageId,
          userText: text,
          recentUserMessages,
          recentAssistantMessages,
        },
          env.NEAR_AGENT_TIMEOUT_MS
        );
        const retried = agentRetry.text.trim();
        if (retried) {
          let finalText = retried;
          if (!env.NEAR_AGENT_SKIP_COMPOSE) {
            try {
              finalText = await composeNearReplyUnified({ actorDisplayName,
                draft: retried,
                situation: agentRetry.composeSituation,
                userMessage: text,
                recentUserMessages,
                recentAssistantMessages,
              });
            } catch (ce) {
              log.warn({ err: ce }, "composeNearReplyUnified failed (faq deflection retry path)");
            }
          }
          capSnap.routeTaken = "agent_faq_retry";
          capSnap.moduleName = parsed.intent;
          capSnap.usedLlmFallback = false;
          capSnap.usedGrowthPipeline = false;
          capSnap.preGrowthCategory = null;
          await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
          await maybeRecordAgentPathGrowthSignals({
            db,
            channel,
            channelUserId,
            inboundMessageId,
            userText: text,
            parsed,
            finalText,
            composeSituation: agentRetry.composeSituation,
            toolsInvoked: agentRetry.log.toolsInvoked,
            agentSteps: agentRetry.log.steps,
          });
          return;
        }
        // Agent 再試行が空振りのときは、行き止まり文面をそのまま返さず最小限の巻き取り回答へ寄せる。
        faqRetryFallbackDraft = buildBroadConsultationFallbackDraft();
      } catch (e) {
        log.warn({ err: e }, "faq weak/deflection retry via near agent failed; keep legacy response");
        faqRetryFallbackDraft = buildBroadConsultationFallbackDraft();
      }
    }

    if (modResult.success && situation === "success" && parsed.intent === "simple_question") {
      // GPT寄り運用では、一般相談の deflection を即 unsupported 候補化せず、まず会話内で巻き取る。
      await maybeRecordFaqDeflectionGrowthSignal({
        db,
        channel,
        channelUserId,
        inboundMessageId,
        userText: text,
        parsed,
        draft: modResult.draft,
      });
    }

    let finalText = faqRetryFallbackDraft ?? modResult.draft;
    if (env.NEAR_GROWTH_USER_ACK_ENABLED && growthGateForAck?.allow) {
      finalText = `${finalText}\n\n※ このご要望は、成長候補として記録し、開発側で検討できるよう控えました。`;
    }
    try {
      finalText = await composeNearReplyUnified({ actorDisplayName,
        draft: finalText,
        situation,
        userMessage: text,
        recentUserMessages,
        recentAssistantMessages,
      });
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReplyUnified failed, sending draft as-is");
    }
    capSnap.routeTaken = "legacy_module";
    capSnap.moduleName = parsed.intent;
    capSnap.usedLlmFallback = false;
    capSnap.usedGrowthPipeline = Boolean(growthGateForAck);
    capSnap.preGrowthCategory = null;
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
  } catch (e) {
    log.error({ err: e }, "orchestrator pipeline error");
    const draft =
      "申し訳ございません、少し調子が悪いようです。お手数ですが、もう一度お試しください。";
    let finalText = draft;
    try {
      finalText = await composeNearReplyUnified({ actorDisplayName,
        draft,
        situation: "error",
        userMessage: text,
        recentUserMessages,
        recentAssistantMessages,
      });
    } catch {
      /* draft のまま */
    }
    capSnap.routeTaken = "orchestrator_error";
    capSnap.usedLlmFallback = false;
    capSnap.usedGrowthPipeline = false;
    capSnap.preGrowthCategory = null;
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log, capSnap, routingTraceId);
  }
}
