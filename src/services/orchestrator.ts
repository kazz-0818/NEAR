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

  if (env.ADMIN_LINE_USER_ID && channelUserId === env.ADMIN_LINE_USER_ID) {
    const growth = await tryHandleAdminGrowthLine({ db, adminUserId: channelUserId, text });
    if (growth.handled) {
      await replyOrPush(replyToken, channelUserId, growth.reply);
      return;
    }
  }

  if (isDeployTimeQuestion(text)) {
    const draft = buildDeployTimeDraft();
    let finalText = draft;
    try {
      finalText = await composeNearReply({ draft, situation: "success", userMessage: text });
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReply failed (deploy time path)");
    }
    await replyOrPush(replyToken, channelUserId, finalText);
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
    await replyOrPush(replyToken, channelUserId, finalText);
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

      scheduleFeatureSuggestion({
        db,
        unsupportedId,
        originalMessage: text,
        intent: parsed,
      });

      const draft =
        "すいません、今はまだそのお願いには対応できません。ただ、できるように改善していきます。内容は記録いたしました。";
      let finalText = draft;
      try {
        finalText = await composeNearReply({ draft, situation: "unsupported", userMessage: text });
      } catch (ce) {
        log.warn({ err: ce }, "composeNearReply failed (unsupported path)");
      }
      await replyOrPush(replyToken, channelUserId, finalText);
      return;
    }

    const modResult = await handler!({
      db,
      channel,
      channelUserId,
      intent: parsed,
      originalText: text,
      inboundMessageId,
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
      scheduleFeatureSuggestion({
        db,
        unsupportedId,
        originalMessage: text,
        intent: parsed,
      });
    }

    let finalText = modResult.draft;
    try {
      finalText = await composeNearReply({ draft: modResult.draft, situation, userMessage: text });
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReply failed, sending draft as-is");
    }
    await replyOrPush(replyToken, channelUserId, finalText);
  } catch (e) {
    log.error({ err: e }, "orchestrator pipeline error");
    const draft =
      "申し訳ございません、少し調子が悪いようです。お手数ですが、もう一度お試しください。";
    let finalText = draft;
    try {
      finalText = await composeNearReply({ draft, situation: "error", userMessage: text });
    } catch {
      /* draft のまま */
    }
    await replyOrPush(replyToken, channelUserId, finalText);
  }
}
