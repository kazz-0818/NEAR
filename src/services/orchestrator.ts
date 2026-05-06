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
  loadRecentAssistantMessages,
  loadRecentUserMessages,
} from "./conversation_context.js";
import {
  promoteGoogleSheetsFollowUp,
  promoteSheetsPendingAffirmative,
  promoteSheetsPendingPick,
} from "./sheetsIntentFollowUp.js";
import {
  explicitUnanchoredSheetReadIntent,
  looksLikeSheetsThreadFollowUp,
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

async function saveIntentRun(
  db: Db,
  inboundMessageId: number,
  parsed: ParsedIntent,
  rawOutput: unknown
): Promise<void> {
  const env = getEnv();
  await db.query(
    `INSERT INTO intent_runs (inbound_message_id, model, raw_output, parsed) VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
    [inboundMessageId, env.OPENAI_INTENT_MODEL, JSON.stringify(rawOutput), JSON.stringify(parsed)]
  );
}

async function replyLineAndRememberOutbound(
  db: Db,
  ctx: { channel: string; channelUserId: string; inboundMessageId: number },
  replyToken: string,
  lineUserId: string,
  finalText: string,
  log: ReturnType<typeof getLogger>
): Promise<void> {
  await replyOrPush(replyToken, lineUserId, finalText);
  try {
    await saveOutboundAssistantText(db, {
      channel: ctx.channel,
      channelUserId: ctx.channelUserId,
      text: finalText,
      inboundMessageId: ctx.inboundMessageId,
    });
  } catch (e) {
    log.warn({ err: e }, "saveOutboundAssistantText failed");
  }
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

export async function handleLineTextMessage(input: {
  db: Db;
  replyToken: string;
  channelUserId: string;
  text: string;
  inboundMessageId: number;
  lineSourceType?: string;
}): Promise<void> {
  const log = getLogger();
  const { db, replyToken, channelUserId, text, inboundMessageId, lineSourceType } = input;
  const channel = "line";
  const env = getEnv();
  const outboundCtx = { channel, channelUserId, inboundMessageId };

  const thin = await runThinRouterPhase({ db, env, channelUserId, text, lineSourceType });
  if (thin.handled) {
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, thin.finalText, log);
    return;
  }

  let recentUserMessages: string[] = [];
  let recentAssistantMessages: string[] = [];
  try {
    recentUserMessages = await loadRecentUserMessages(db, channel, channelUserId, inboundMessageId);
    recentAssistantMessages = await loadRecentAssistantMessages(db, channel, channelUserId, inboundMessageId);
  } catch (ctxErr) {
    log.warn({ err: ctxErr }, "load recent conversation context failed; continuing without context");
  }

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
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, pendingHit.finalText, log);
    return;
  }

  if (!env.NEAR_SECRETARY_LAYER_DISABLED) {
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
              finalText = await composeNearReplyUnified({
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
            await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
            return;
          } catch (e) {
            log.warn({ err: e }, "secretary edit_previous_output failed; continuing to intent routing");
          }
        }
      }

      if (interpretation.mode === "clarify_missing_info" && interpretation.confidence >= 0.52) {
        const shouldSkipClarifyForConsultation =
          looksLikeBroadConsultation(text) || looksLikeBroadConsultationFollowup(text, recentUserMessages);
        if (shouldSkipClarifyForConsultation) {
          log.info({ mode: interpretation.mode }, "secretary clarify skipped: prefer direct broad consultation answer");
        } else
        if (
          sheetsReadIntegrationEnabled() &&
          (looksLikeSheetsThreadFollowUp(text, recentUserMessages) ||
            explicitUnanchoredSheetReadIntent(text, recentUserMessages))
        ) {
          log.info(
            { mode: interpretation.mode },
            "secretary clarify skipped: sheet read / drive search routing likely"
          );
        } else {
          try {
            const clarifyDraft = await buildSecretaryClarificationReply({
              userMessage: text,
              recentUserMessages,
              recentAssistantMessages,
            });
            let finalText = clarifyDraft;
            try {
              finalText = await composeNearReplyUnified({
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
            await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
            return;
          } catch (e) {
            log.warn({ err: e }, "secretary clarify_missing_info failed; continuing to intent routing");
          }
        }
      }
    } catch (e) {
      log.warn({ err: e }, "secretary layer error; continuing to intent routing");
    }
  }

  let parsed: ParsedIntent;
  try {
    parsed = await classifyIntent(text);
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

  try {
    parsed = await promoteSheetsPendingPick(text, parsed, db, channelUserId);
    parsed = await promoteSheetsPendingAffirmative(text, parsed, db, channelUserId);
    parsed = await promoteGoogleSheetsFollowUp(text, parsed, recentUserMessages, db, channelUserId);
  } catch (promoErr) {
    log.warn({ err: promoErr }, "promoteGoogleSheetsFollowUp failed; using classifyIntent result");
  }

  // GPT寄り運用: 一般相談が unknown に落ちたら simple_question へ救済して会話で巻き取る。
  if (parsed.intent === "unknown_custom_request" && looksLikeBroadConsultation(text)) {
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

  await saveIntentRun(db, inboundMessageId, parsed, {
    ok: true,
    routing_meta: { phase: "post_promote" },
  });

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

  const handler = getHandler(parsed.intent);
  const routable =
    parsed.can_handle === true && parsed.intent !== "unknown_custom_request" && handler !== undefined;

  if (shouldInvokeNearAgent(env, parsed.intent, routable, text)) {
    try {
      const agentResult = await runNearAgentTurn({
        db,
        channel,
        channelUserId,
        inboundMessageId,
        userText: text,
        recentUserMessages,
        recentAssistantMessages,
      });
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
            finalText = await composeNearReplyUnified({
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
        await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
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
    if (!routable) {
      const unsupportedId = await logUnsupportedRequest({
        db,
        channel,
        channelUserId,
        originalMessage: text,
        intent: parsed,
        inboundMessageId,
        whyOverride:
          parsed.intent === "unknown_custom_request"
            ? "該当処理モジュールなし"
            : !parsed.can_handle
              ? parsed.reason ?? "can_handle が false"
              : "ハンドラ未登録",
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
        draft = `${draftBase}\n\n※ このご要望は、改善候補として記録し、開発側で検討できるよう控えました。`;
      }
      let finalText = draft;
      try {
        finalText = await composeNearReplyUnified({
          draft,
          situation: "unsupported",
          userMessage: text,
          recentUserMessages,
          recentAssistantMessages,
        });
      } catch (ce) {
        log.warn({ err: ce }, "composeNearReplyUnified failed (unsupported path)");
      }
      await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
      return;
    }

    const modResult = await handler!({
      db,
      channel,
      channelUserId,
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
        const agentRetry = await runNearAgentTurn({
          db,
          channel,
          channelUserId,
          inboundMessageId,
          userText: text,
          recentUserMessages,
          recentAssistantMessages,
        });
        const retried = agentRetry.text.trim();
        if (retried) {
          let finalText = retried;
          if (!env.NEAR_AGENT_SKIP_COMPOSE) {
            try {
              finalText = await composeNearReplyUnified({
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
          await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
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
        faqRetryFallbackDraft =
          "もちろんお手伝いできます。まずは実務で使える形で整理します。\n" +
          "物販マーケなら、①誰に売るか（顧客像）②何で選ばれるか（差別化）③どこで獲得するか（集客チャネル）の順で決めると進めやすいです。";
      } catch (e) {
        log.warn({ err: e }, "faq weak/deflection retry via near agent failed; keep legacy response");
        faqRetryFallbackDraft =
          "もちろんお手伝いできます。まずは実務で使える形で整理します。\n" +
          "物販マーケなら、①誰に売るか（顧客像）②何で選ばれるか（差別化）③どこで獲得するか（集客チャネル）の順で決めると進めやすいです。";
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
      finalText = `${finalText}\n\n※ このご要望は、改善候補として記録し、開発側で検討できるよう控えました。`;
    }
    try {
      finalText = await composeNearReplyUnified({
        draft: finalText,
        situation,
        userMessage: text,
        recentUserMessages,
        recentAssistantMessages,
      });
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReplyUnified failed, sending draft as-is");
    }
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
  } catch (e) {
    log.error({ err: e }, "orchestrator pipeline error");
    const draft =
      "申し訳ございません、少し調子が悪いようです。お手数ですが、もう一度お試しください。";
    let finalText = draft;
    try {
      finalText = await composeNearReplyUnified({
        draft,
        situation: "error",
        userMessage: text,
        recentUserMessages,
        recentAssistantMessages,
      });
    } catch {
      /* draft のまま */
    }
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
  }
}
