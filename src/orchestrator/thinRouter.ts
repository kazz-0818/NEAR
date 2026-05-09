import type { Db } from "../db/client.js";
import type { Env } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import {
  buildDeployTimeDraft,
  isDeployTimeQuestion,
} from "../lib/buildInfo.js";
import { buildWhatsNewDraft, isWhatsNewCapabilityQuestion } from "../lib/whatsNew.js";
import { tryHandleAdminGrowthLine } from "../services/growth_admin_line.js";
import { tryHandleGrowthRequestingUserLine } from "../services/growth_user_line.js";
import {
  tryHandleGoogleAccountListOrSwitch,
  tryHandleGoogleDiagnostic,
  tryHandleGoogleOAuthUserLine,
} from "../services/google_oauth_user_line.js";
import { composeNearReplyUnified } from "../agent/compose/nearComposer.js";
import { tryHandlePermissionLine, tryConsumePendingPermOp } from "../services/permission_line.js";
import {
  hasPendingSheetPick,
  isPendingSheetPickIndexMessage,
} from "../db/user_sheet_pending_pick_repo.js";
import { isTaskManagementCommand, tryHandleTaskLine } from "../services/task_line.js";

export type ThinRouterResult =
  | { handled: true; finalText: string }
  | { handled: false; forceIntent?: string };

/**
 * 「スプレッドシート上のタスク一覧/未完了/指示確認」を local task_line ではなく
 * シート読取に回すための判定。
 */
function looksLikeTaskSheetReadRequest(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  const hasSheetWord = /スプレッ?ト|スプレッド|スプシ|spreadsheet|docs\.google\.com\/spreadsheets|シート/u.test(t);
  if (!hasSheetWord) return false;
  const hasTaskTopic = /タスク|指示|未完了|進行中/u.test(t);
  if (!hasTaskTopic) return false;
  const readIntent = /一覧|見せ|見たい|出して|確認|教えて|読んで|読み取|取得/u.test(t);
  if (!readIntent) return false;
  const saveIntent = /追加|登録|保存|入れて|作成|新規/u.test(t);
  return !saveIntent;
}

/**
 * LLM 意図分類より前の決定的ルート（成長・OAuth・テンプレ系）。
 */
export async function runThinRouterPhase(input: {
  db: Db;
  env: Env;
  channelUserId: string;
  actorUserId?: string;
  groupId?: string;
  text: string;
  lineSourceType?: string;
  recentAssistantMessages?: string[];
}): Promise<ThinRouterResult> {
  const log = getLogger();
  const { db, env, channelUserId, actorUserId, groupId, text, lineSourceType, recentAssistantMessages } = input;

  const effectiveActorId = actorUserId ?? channelUserId;
  // グループでは groupId、1:1 では actorUserId をチャンネルスコープとして使う
  const channelId = groupId ?? effectiveActorId;

  // 権限操作の保留応答（はい / 番号 / キャンセル）を最優先で処理
  // ※ sheet pick の短文チェックより前に実行して権限フローが sheet pick に誤爆しないようにする
  const pendingPerm = await tryConsumePendingPermOp({ db, actorUserId: effectiveActorId, channelId, text });
  if (pendingPerm.handled) {
    return { handled: true, finalText: pendingPerm.reply };
  }

  // 権限管理コマンド（admin 以上のユーザーが送った場合）
  const permResult = await tryHandlePermissionLine({ db, actorUserId: effectiveActorId, channelId, text });
  if (permResult.handled) {
    return { handled: true, finalText: permResult.reply };
  }

  // スプレッドシート候補選択の保留チェック（タスク管理より先に実行）
  // 「5」「2番」などがタスク文脈に誤爆しないようにするため最優先で確認する
  const textNorm = text.normalize("NFKC").trim();
  const looksLikePick =
    isPendingSheetPickIndexMessage(text) ||
    (textNorm.length <= 50 && !/\n/.test(textNorm) && !/docs\.google\.com/i.test(textNorm));
  const hasPick = looksLikePick
    ? await hasPendingSheetPick(db, channelUserId).catch(() => false)
    : false;
  if (hasPick) {
    log.info({ channelUserId, textLen: textNorm.length }, "pending sheet pick detected — forcing google_sheets_query");
    return { handled: false, forceIntent: "google_sheets_query" };
  }

  // 「スプレッドシートのタスク一覧」などは local task ではなくシート読み取りを優先
  if (looksLikeTaskSheetReadRequest(text)) {
    log.info({ channelUserId, text }, "task-sheet read request detected — forcing google_sheets_query");
    return { handled: false, forceIntent: "google_sheets_query" };
  }

  // タスク管理コマンド（一覧・完了・削除・編集）
  // sheet pick がない場合のみ実行する（数字がシート候補番号に誤爆しないよう）
  if (isTaskManagementCommand(text, recentAssistantMessages)) {
    const taskResult = await tryHandleTaskLine({
      db,
      text,
      channelUserId,
      actorUserId: effectiveActorId,
      groupId,
      recentAssistantMessages,
    });
    if (taskResult.handled) {
      return { handled: true, finalText: taskResult.reply };
    }
  }

  if (env.ADMIN_LINE_USER_ID && channelUserId === env.ADMIN_LINE_USER_ID) {
    const growth = await tryHandleAdminGrowthLine({ db, adminUserId: channelUserId, text });
    if (growth.handled) {
      return { handled: true, finalText: growth.reply };
    }
  }

  const userGrowth = await tryHandleGrowthRequestingUserLine({ db, channelUserId, text, lineSourceType });
  if (userGrowth.handled) {
    return { handled: true, finalText: userGrowth.reply };
  }

  const googleDiag = await tryHandleGoogleDiagnostic({ db, channelUserId, text });
  if (googleDiag.handled && googleDiag.reply) {
    return { handled: true, finalText: googleDiag.reply };
  }

  const googleOauth = await tryHandleGoogleOAuthUserLine({ db, channelUserId, text });
  if (googleOauth.handled && googleOauth.reply) {
    return { handled: true, finalText: googleOauth.reply };
  }

  const googleAcct = await tryHandleGoogleAccountListOrSwitch({ db, channelUserId, text });
  if (googleAcct.handled && googleAcct.reply) {
    return { handled: true, finalText: googleAcct.reply };
  }

  if (isDeployTimeQuestion(text)) {
    const draft = buildDeployTimeDraft();
    try {
      const finalText = await composeNearReplyUnified({ draft, situation: "success", userMessage: text });
      return { handled: true, finalText };
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReplyUnified failed (deploy time path)");
      return { handled: true, finalText: draft };
    }
  }

  if (isWhatsNewCapabilityQuestion(text)) {
    const draft = await buildWhatsNewDraft(db);
    try {
      const finalText = await composeNearReplyUnified({ draft, situation: "success", userMessage: text });
      return { handled: true, finalText };
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReplyUnified failed (whats new path)");
      return { handled: true, finalText: draft };
    }
  }

  return { handled: false };
}
