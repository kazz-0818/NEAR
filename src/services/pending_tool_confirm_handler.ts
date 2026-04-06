import { getEnv } from "../config/env.js";
import type { Db } from "../db/client.js";
import {
  cancelPendingToolConfirmation,
  finalizePendingToolConfirmation,
  getPendingToolConfirmation,
} from "../db/pending_tool_confirm_repo.js";
import {
  isSpreadsheetConfirmAffirmative,
  isSpreadsheetConfirmNegative,
} from "../db/user_sheet_pending_confirm_repo.js";
import { getLogger } from "../lib/logger.js";
import { executeStoredSideEffectTool } from "../agent/tools/storedSideEffectExecutor.js";
import type { NearAgentTurnInput } from "../agent/types.js";
import { composeNearReplyUnified } from "../agent/compose/nearComposer.js";

export type PendingToolConfirmHandlerInput = {
  db: Db;
  channel: string;
  channelUserId: string;
  text: string;
  inboundMessageId: number;
  recentUserMessages: string[];
  recentAssistantMessages: string[];
};

/**
 * Thin Router の直後に呼ぶ。保留中の副作用ツール確認を消費する。
 * NEAR_TOOL_CONFIRM_ENABLED がオフなら常に handled: false。
 */
export async function tryHandlePendingToolConfirmation(
  input: PendingToolConfirmHandlerInput
): Promise<{ handled: boolean; finalText?: string }> {
  const env = getEnv();
  const log = getLogger();

  if (!env.NEAR_TOOL_CONFIRM_ENABLED) {
    return { handled: false };
  }

  const pending = await getPendingToolConfirmation(input.db, input.channel, input.channelUserId);
  if (!pending) {
    return { handled: false };
  }

  const agentCtx: NearAgentTurnInput = {
    db: input.db,
    channel: input.channel,
    channelUserId: input.channelUserId,
    inboundMessageId: input.inboundMessageId,
    userText: input.text,
    recentUserMessages: input.recentUserMessages,
    recentAssistantMessages: input.recentAssistantMessages,
  };

  if (isSpreadsheetConfirmNegative(input.text)) {
    await cancelPendingToolConfirmation(input.db, input.channel, input.channelUserId);
    let finalText = "了解しました。登録は取りやめました。";
    try {
      finalText = await composeNearReplyUnified({
        draft: finalText,
        situation: "success",
        userMessage: input.text,
        recentUserMessages: input.recentUserMessages,
        recentAssistantMessages: input.recentAssistantMessages,
      });
    } catch (e) {
      log.warn({ err: e }, "composeNearReplyUnified failed (pending tool cancel)");
    }
    return { handled: true, finalText };
  }

  if (isSpreadsheetConfirmAffirmative(input.text)) {
    const row = await finalizePendingToolConfirmation(input.db, input.channel, input.channelUserId);
    if (!row) {
      let finalText = "確認の有効期限が切れているか、すでに処理済みのようです。もう一度お願いします。";
      try {
        finalText = await composeNearReplyUnified({
          draft: finalText,
          situation: "followup",
          userMessage: input.text,
          recentUserMessages: input.recentUserMessages,
          recentAssistantMessages: input.recentAssistantMessages,
        });
      } catch (e) {
        log.warn({ err: e }, "composeNearReplyUnified failed (pending tool stale)");
      }
      return { handled: true, finalText };
    }

    const { mod } = await executeStoredSideEffectTool(row.tool_name, row.args_json, agentCtx);
    const situation =
      mod.situation === "unsupported"
        ? "unsupported"
        : mod.situation === "error"
          ? "error"
          : mod.situation === "followup"
            ? "followup"
            : "success";

    let finalText = mod.draft;
    try {
      finalText = await composeNearReplyUnified({
        draft: mod.draft,
        situation,
        userMessage: input.text,
        recentUserMessages: input.recentUserMessages,
        recentAssistantMessages: input.recentAssistantMessages,
      });
    } catch (e) {
      log.warn({ err: e }, "composeNearReplyUnified failed (pending tool execute)");
    }
    return { handled: true, finalText };
  }

  if (env.NEAR_TOOL_CONFIRM_BLOCKING) {
    let finalText =
      "前の操作の確認がまだ残っています。「はい」で実行、「いいえ」でキャンセルできます。別の用件のときは、いったん「いいえ」で閉じてからお願いします。";
    try {
      finalText = await composeNearReplyUnified({
        draft: finalText,
        situation: "followup",
        userMessage: input.text,
        recentUserMessages: input.recentUserMessages,
        recentAssistantMessages: input.recentAssistantMessages,
      });
    } catch (e) {
      log.warn({ err: e }, "composeNearReplyUnified failed (pending tool blocking)");
    }
    return { handled: true, finalText };
  }

  return { handled: false };
}
