import { getEnv } from "../config/env.js";
import type { Db } from "../db/client.js";
import { getHandler } from "../modules/registry.js";
import { logUnsupportedRequest } from "../modules/unsupported_request_logger.js";
import { scheduleFeatureSuggestion } from "../modules/feature_suggester.js";
import type { ParsedIntent } from "../models/intent.js";
import { classifyIntent } from "./intent_classifier.js";
import { composeNearReply } from "./reply_composer.js";
import { replyOrPush } from "../channels/line/client.js";
import {
  buildDeployTimeDraft,
  isDeployTimeQuestion,
} from "../lib/buildInfo.js";
import { getLogger } from "../lib/logger.js";
import { buildWhatsNewDraft, isWhatsNewCapabilityQuestion } from "../lib/whatsNew.js";
import { tryHandleAdminGrowthLine } from "./growth_admin_line.js";
import { tryHandleGrowthRequestingUserLine } from "./growth_user_line.js";
import {
  evaluateGrowthSuggestionEligibility,
  markUnsupportedGrowthSkipped,
} from "./growth_suggestion_gate.js";
import { loadRecentAssistantMessages, loadRecentUserMessages } from "./conversation_context.js";
import { promoteGoogleSheetsFollowUp } from "./sheetsIntentFollowUp.js";
import { tryHandleGoogleOAuthUserLine } from "./google_oauth_user_line.js";
import { saveOutboundAssistantText } from "./outbound_store.js";

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

export async function handleLineTextMessage(input: {
  db: Db;
  replyToken: string;
  channelUserId: string;
  text: string;
  inboundMessageId: number;
}): Promise<void> {
  const log = getLogger();
  const { db, replyToken, channelUserId, text, inboundMessageId } = input;
  const channel = "line";
  const env = getEnv();
  const outboundCtx = { channel, channelUserId, inboundMessageId };

  if (env.ADMIN_LINE_USER_ID && channelUserId === env.ADMIN_LINE_USER_ID) {
    const growth = await tryHandleAdminGrowthLine({ db, adminUserId: channelUserId, text });
    if (growth.handled) {
      await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, growth.reply, log);
      return;
    }
  }

  const userGrowth = await tryHandleGrowthRequestingUserLine({ db, channelUserId, text });
  if (userGrowth.handled) {
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, userGrowth.reply, log);
    return;
  }

  const googleOauth = await tryHandleGoogleOAuthUserLine({ db, channelUserId, text });
  if (googleOauth.handled && googleOauth.reply) {
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, googleOauth.reply, log);
    return;
  }

  if (isDeployTimeQuestion(text)) {
    const draft = buildDeployTimeDraft();
    let finalText = draft;
    try {
      finalText = await composeNearReply({ draft, situation: "success", userMessage: text });
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReply failed (deploy time path)");
    }
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
    return;
  }

  if (isWhatsNewCapabilityQuestion(text)) {
    const draft = await buildWhatsNewDraft(db);
    let finalText = draft;
    try {
      finalText = await composeNearReply({ draft, situation: "success", userMessage: text });
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReply failed (whats new path)");
    }
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
    return;
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

  let recentUserMessages: string[] = [];
  let recentAssistantMessages: string[] = [];
  try {
    recentUserMessages = await loadRecentUserMessages(db, channel, channelUserId, inboundMessageId);
    recentAssistantMessages = await loadRecentAssistantMessages(db, channel, channelUserId, inboundMessageId);
  } catch (ctxErr) {
    log.warn({ err: ctxErr }, "load recent conversation context failed; continuing without context");
  }

  try {
    parsed = await promoteGoogleSheetsFollowUp(text, parsed, recentUserMessages, db, channelUserId);
  } catch (promoErr) {
    log.warn({ err: promoErr }, "promoteGoogleSheetsFollowUp failed; using classifyIntent result");
  }

  await saveIntentRun(db, inboundMessageId, parsed, { ok: true });

  const handler = getHandler(parsed.intent);
  const routable =
    parsed.can_handle === true && parsed.intent !== "unknown_custom_request" && handler !== undefined;

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

      const gate = await evaluateGrowthSuggestionEligibility({ db, text, parsed });
      if (gate.allow) {
        scheduleFeatureSuggestion({
          db,
          unsupportedId,
          originalMessage: text,
          intent: parsed,
        });
      } else {
        await markUnsupportedGrowthSkipped(db, unsupportedId, gate.reason);
        log.info({ unsupportedId, reason: gate.reason }, "growth suggestion skipped by gate");
      }

      const draft =
        "そのお願いは、いまの私の定型機能だけではまだカバーしきれていません。内容は控えとして残し、近いうちに手が届くよう整えていきます。言い換えや、いま手伝える範囲に寄せた相談でも大丈夫です。";
      let finalText = draft;
      try {
        finalText = await composeNearReply({
          draft,
          situation: "unsupported",
          userMessage: text,
          recentUserMessages,
          recentAssistantMessages,
        });
      } catch (ce) {
        log.warn({ err: ce }, "composeNearReply failed (unsupported path)");
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
      const gate = await evaluateGrowthSuggestionEligibility({ db, text, parsed });
      if (gate.allow) {
        scheduleFeatureSuggestion({
          db,
          unsupportedId,
          originalMessage: text,
          intent: parsed,
        });
      } else {
        await markUnsupportedGrowthSkipped(db, unsupportedId, gate.reason);
        log.info({ unsupportedId, reason: gate.reason }, "growth suggestion skipped by gate");
      }
    }

    let finalText = modResult.draft;
    try {
      finalText = await composeNearReply({
        draft: modResult.draft,
        situation,
        userMessage: text,
        recentUserMessages,
        recentAssistantMessages,
      });
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReply failed, sending draft as-is");
    }
    await replyLineAndRememberOutbound(db, outboundCtx, replyToken, channelUserId, finalText, log);
  } catch (e) {
    log.error({ err: e }, "orchestrator pipeline error");
    const draft =
      "申し訳ございません、少し調子が悪いようです。お手数ですが、もう一度お試しください。";
    let finalText = draft;
    try {
      finalText = await composeNearReply({
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
