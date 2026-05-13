import type { Db } from "../db/client.js";
import type { Env } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import {
  buildDeployTimeDraft,
  isDeployTimeQuestion,
} from "../lib/buildInfo.js";
import { buildWhatsNewDraft, isWhatsNewCapabilityQuestion } from "../lib/whatsNew.js";
import { tryHandleAdminGrowthLine } from "../services/growth_admin_line.js";
import { tryHandleImprovementCapsuleAdminLine } from "../services/improvement_capsule_admin_line.js";
import { tryHandleGrowthRequestingUserLine } from "../services/growth_user_line.js";
import {
  tryHandleGoogleAccountListOrSwitch,
  tryHandleGoogleDiagnostic,
  tryHandleGoogleOAuthUserLine,
} from "../services/google_oauth_user_line.js";
import { composeNearReplyUnified } from "../agent/compose/nearComposer.js";
import { tryHandlePermissionLine, tryConsumePendingPermOp } from "../services/permission_line.js";
import {
  clearPendingSheetPick,
  hasPendingSheetPick,
  isPendingSheetPickIndexMessage,
  savePendingSheetPick,
} from "../db/user_sheet_pending_pick_repo.js";
import { normalizeUserUtterance } from "../lib/utteranceNormalizer.js";
import { resolveUserOperation } from "../lib/utteranceResolver.js";
import { resolveSemanticOperation } from "../services/semantic_operation_resolver.js";
import { isTaskManagementCommand, tryHandleTaskLine, type TaskLineResult } from "../services/task_line.js";
import { tryResolveReminderFromRecentTaskList } from "../services/task_reminder_router.js";
import { extractTaskItemsFromAssistantMessages, parseTaskTargetNumber } from "../lib/taskListContext.js";
import {
  isExplicitGrowthDevelopmentRequest,
  isForcedGrowthOrIssueCommand,
  isUserConfusionOrNegationSignal,
} from "../lib/growthExplicitRequest.js";
import {
  applyReminderTimeUpdate,
  resolveConversationTurn,
} from "../lib/conversationTurnResolver.js";
import type { UserRole } from "../db/user_roles_repo.js";
import { hasRole } from "../lib/permissions.js";
import type { RoutingTracePatch } from "../services/routing_trace_service.js";
import { getLatestRoutingTraceBeforeInbound } from "../services/routing_trace_service.js";
import {
  formatRoutingDebugReportForLine,
  isRoutingDebugQuery,
  matchOneClickImprovementQuery,
} from "../services/routing_debug_command.js";
import { saveOneClickImprovementCandidate, saveUserRejectedRouteCandidate } from "../services/improvement_manual_capture.js";
import {
  getSessionMemoryValue,
  upsertSessionMemory,
} from "../services/conversation_session_memory.js";
import type { TaskListItem } from "../lib/taskListContext.js";

export type ThinRouterResult =
  | { handled: true; finalText: string; routingTracePatch?: RoutingTracePatch }
  | { handled: false; forceIntent?: string; forceRequiredParams?: Record<string, unknown>; routingTracePatch?: RoutingTracePatch };

function looksLikeContextDependentShortTaskText(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  return /(これ|それ|あれ|さっきの|上のやつ|お願い|入れといて|やっといて|消しといて|見せて|出して)/u.test(t);
}

function isMostlyHiraganaText(text: string): boolean {
  const t = text.normalize("NFKC").replace(/\s+/g, "");
  if (!t) return false;
  const hiraLike = (t.match(/[ぁ-んー]/g) ?? []).length;
  return hiraLike / t.length >= 0.45;
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
  inboundMessageId?: number;
  lineSourceType?: string;
  recentUserMessages?: string[];
  recentAssistantMessages?: string[];
  quotedAssistantMessage?: string;
  /** ルーティングデバッグ用（省略時は guest） */
  actorRole?: UserRole;
}): Promise<ThinRouterResult> {
  const log = getLogger();
  const {
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
    quotedAssistantMessage,
    actorRole: actorRoleInput,
  } = input;
  const actorRoleResolved: UserRole = actorRoleInput ?? "guest";

  const effectiveActorId = actorUserId ?? channelUserId;
  // グループでは groupId、1:1 では actorUserId をチャンネルスコープとして使う
  const channelId = groupId ?? effectiveActorId;

  async function persistTaskLineSessionMemory(taskResult: TaskLineResult): Promise<void> {
    const w = taskResult.sessionMemoryWrite;
    if (!w) return;
    await upsertSessionMemory(db, {
      channelUserId,
      memoryType: w.memoryType,
      value: w.value,
      sourceMessageId: inboundMessageId != null && inboundMessageId > 0 ? inboundMessageId : null,
      sourceRoute: "task_line",
      expiresAt: new Date(Date.now() + w.ttlMinutes * 60 * 1000),
    }).catch(() => {});
  }

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

  const textNorm = text.normalize("NFKC").trim();
  const inboundId = inboundMessageId ?? 0;

  // ──────────────────────────────────────────────────────────────
  // 2. ルーティング判定レポート（管理者以上。pending より優先）
  // ──────────────────────────────────────────────────────────────
  if (inboundId > 0 && isRoutingDebugQuery(textNorm)) {
    if (hasRole(actorRoleResolved, "admin")) {
      const prev = await getLatestRoutingTraceBeforeInbound(db, channelUserId, inboundId);
      const body = prev
        ? formatRoutingDebugReportForLine(prev)
        : "直前のルーティング記録がまだありません。";
      return {
        handled: true,
        finalText: body,
        routingTracePatch: { route: "routing_debug_report", reason: "admin_routing_trace_request" },
      };
    }
    return {
      handled: true,
      finalText: "ルーティングの詳細は管理者向けです。",
      routingTracePatch: { route: "routing_debug_denied" },
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 3. ワンクリック改善候補（即 Issue 化しない / pending より優先）
  // ──────────────────────────────────────────────────────────────
  if (inboundId > 0) {
    const oneClick = matchOneClickImprovementQuery(textNorm);
    if (oneClick) {
      const priorNear =
        recentAssistantMessages && recentAssistantMessages.length > 0
          ? recentAssistantMessages[recentAssistantMessages.length - 1]!
          : "";
      const priorUser =
        recentUserMessages && recentUserMessages.length > 0
          ? recentUserMessages[recentUserMessages.length - 1]!
          : undefined;
      const r = await saveOneClickImprovementCandidate({
        db,
        channelUserId,
        inboundMessageId: inboundId,
        userText: text,
        kind: oneClick,
        priorNearReply: priorNear || "（直前の返答が取得できませんでした）",
        priorUserMessage: priorUser,
      });
      const ack = r.inserted
        ? "直前の会話を改善候補として保存しました。\n\n日次または手動で「改善カプセル分析して」と送るとまとめ分析できます。"
        : "同じ理由の改善候補は直近ですでに登録済みです。";
      return {
        handled: true,
        finalText: ack,
        routingTracePatch: { route: "manual_improvement_capture", used_improvement_capsule_candidate: true },
      };
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 3b. 直近リマインド一覧メモリからの N 番削除
  // ──────────────────────────────────────────────────────────────
  if (
    inboundId > 0 &&
    !isExplicitGrowthDevelopmentRequest(text) &&
    !isForcedGrowthOrIssueCommand(text)
  ) {
    const remDel = textNorm.match(/^(\d{1,2})\s*番?(?:を|は)?(?:削除|消して)(?:して)?$/u);
    if (remDel) {
      const mem = await getSessionMemoryValue<{ items: Array<{ index: number; id: number; message: string }> }>(
        db,
        channelUserId,
        "latest_reminder_list"
      );
      if (mem?.items?.length) {
        const n = parseInt(remDel[1]!, 10);
        const hit = mem.items.find((x) => x.index === n);
        if (hit) {
          try {
            await db.query(`DELETE FROM near_reminders WHERE id = $1 AND actor_user_id = $2`, [hit.id, effectiveActorId]);
            return {
              handled: true,
              finalText: `了解。${n}番「${hit.message}」のリマインドを削除しました。`,
              routingTracePatch: { route: "internal_reminder_delete", reminder_used: true },
            };
          } catch (e) {
            log.warn({ err: e }, "session memory reminder delete failed");
          }
        }
      }
    }
  }

  // ================================================================
  // 【Conversation Turn Resolver】混乱・一覧・内部タスク・時刻変更
  // pending より前に「この発言は何の続きか」を判定する。
  // ================================================================
  const turnRes = await resolveConversationTurn({
    db,
    channelUserId,
    actorUserId: effectiveActorId,
    text,
    recentUserMessages,
    recentAssistantMessages,
    quotedAssistantMessage,
  });

  // B. 混乱・否定 + stale pending → 解除して謝罪 + 改善候補
  if (turnRes.kind === "clear_stale_pending") {
    await clearPendingSheetPick(db, channelUserId).catch(() => {});
    log.info({ channelUserId, reason: turnRes.reason }, "conversationTurnResolver: clear_stale_pending");
    if (inboundId > 0) {
      const priorNear =
        recentAssistantMessages && recentAssistantMessages.length > 0
          ? recentAssistantMessages[recentAssistantMessages.length - 1]!
          : "";
      if (priorNear) {
        void saveUserRejectedRouteCandidate({
          db,
          channelUserId,
          inboundMessageId: inboundId,
          userText: text,
          priorNearReply: priorNear,
        }).catch(() => {});
      }
    }
    return {
      handled: true,
      finalText: turnRes.apologyText,
      routingTracePatch: {
        route: "clear_stale_pending",
        cleared_pending: true,
        used_pending: true,
        pending_type: "sheet_pick",
      },
    };
  }

  // C. リマインド一覧 → NEAR 内部 DB から取得（Drive/Sheets に流さない）
  if (turnRes.kind === "internal_reminder_list") {
    await clearPendingSheetPick(db, channelUserId).catch(() => {});
    log.info({ channelUserId }, "conversationTurnResolver: internal_reminder_list");
    try {
      const result = await db.query<{ id: number; message: string; remind_at: string }>(
        `SELECT id, message, remind_at
         FROM near_reminders
         WHERE actor_user_id = $1 AND status = 'pending' AND remind_at > now()
         ORDER BY remind_at ASC LIMIT 20`,
        [effectiveActorId]
      );
      if (result.rows.length === 0) {
        return {
          handled: true,
          finalText:
            "現在設定中のリマインドはありません。\n\nリマインドを設定する場合は「明日14時にEC出品を通知して」のように送ってください。",
          routingTracePatch: { route: "internal_reminder_list", reminder_used: true },
        };
      }
      const lines: string[] = ["現在のリマインド一覧です。", ""];
      const memItems: Array<{ index: number; id: number; message: string; remind_at: string }> = [];
      for (let i = 0; i < result.rows.length; i++) {
        const r = result.rows[i]!;
        const dt = new Date(r.remind_at).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        lines.push(`${i + 1}. ${r.message}`);
        lines.push(`   通知日時：${dt}`);
        lines.push("");
        memItems.push({ index: i + 1, id: r.id, message: r.message, remind_at: r.remind_at });
      }
      lines.push("変更する場合は「1番を15時に変更」「2番を削除」のように送ってください。");
      void upsertSessionMemory(db, {
        channelUserId,
        memoryType: "latest_reminder_list",
        value: { items: memItems },
        sourceMessageId: inboundId > 0 ? inboundId : null,
        sourceRoute: "internal_reminder_list",
        expiresAt: new Date(Date.now() + 90 * 60 * 1000),
      }).catch(() => {});
      return {
        handled: true,
        finalText: lines.join("\n"),
        routingTracePatch: { route: "internal_reminder_list", reminder_used: true, cleared_pending: true },
      };
    } catch (e) {
      log.warn({ err: e }, "reminder list query failed — falling through to LLM");
    }
  }

  // D. 内部タスクリスト → stale pending を解除し、タスクルーティングへ続行
  if (turnRes.kind === "internal_task_list") {
    await clearPendingSheetPick(db, channelUserId).catch(() => {});
    log.info({ channelUserId }, "conversationTurnResolver: internal_task_list — cleared stale pending, continuing to task routing");
    // fall through: タスクルーティングブロックが処理する
  }

  // E. 直前リマインドの時間変更
  if (turnRes.kind === "reminder_time_update") {
    const { newTimeText, recentReminders } = turnRes;
    if (recentReminders.length === 1) {
      const r = recentReminders[0]!;
      const originalDate = new Date(r.remind_at);
      const newDate = applyReminderTimeUpdate(originalDate, newTimeText);
      if (newDate) {
        try {
          await db.query(`UPDATE near_reminders SET remind_at = $1 WHERE id = $2`, [
            newDate.toISOString(),
            r.id,
          ]);
          const when = newDate.toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          log.info({ channelUserId, reminderId: r.id, newDate }, "reminder_time_update: updated");
          void upsertSessionMemory(db, {
            channelUserId,
            memoryType: "latest_reminder_updated",
            value: { id: r.id, message: r.message, remind_at: newDate.toISOString() },
            sourceMessageId: inboundId > 0 ? inboundId : null,
            sourceRoute: "reminder_time_update",
            expiresAt: new Date(Date.now() + 120 * 60 * 1000),
          }).catch(() => {});
          return {
            handled: true,
            finalText: `了解です。「${r.message}」を${when}に変更しました。`,
            routingTracePatch: { route: "reminder_time_update", reminder_used: true },
          };
        } catch (e) {
          log.warn({ err: e }, "reminder_time_update: DB update failed — falling through");
        }
      }
    } else if (recentReminders.length > 1) {
      const list = recentReminders
        .map((r, i) => {
          const dt = new Date(r.remind_at).toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
            hour: "2-digit",
            minute: "2-digit",
          });
          return `${i + 1}. ${r.message}（${dt}）`;
        })
        .join("\n");
      return {
        handled: true,
        finalText: `どのリマインドを${newTimeText}に変更しますか？\n\n${list}\n\n番号で教えてください。`,
        routingTracePatch: { route: "reminder_time_update_ambiguous", reminder_used: true },
      };
    }
    // 変換失敗 or 過去時刻 → fall through
  }

  // ================================================================
  // 以降は既存ルーティング（Growth / pending / task / semantic）
  // ================================================================

  // Growth 明示要望 / 混乱シグナルの判定（pending バイパス用）
  const isGrowthRequest = isExplicitGrowthDevelopmentRequest(text) || isForcedGrowthOrIssueCommand(text);
  const isConfusion = isUserConfusionOrNegationSignal(text);
  // internal_task_list も pending pick をバイパスする
  const bypassPendingPick =
    isGrowthRequest || isConfusion || turnRes.kind === "internal_task_list";

  if (isGrowthRequest) {
    log.info({ channelUserId, textLen: textNorm.length }, "explicit growth request — bypassing stale pending states in thinRouter");
  }
  if (isConfusion) {
    log.info({ channelUserId, textLen: textNorm.length }, "user confusion signal — bypassing stale pending states in thinRouter");
  }

  // スプレッドシート候補選択の保留チェック（タスク管理より先に実行）
  // Growth / 混乱 / 内部タスクリストはバイパスする
  if (!bypassPendingPick) {
    const looksLikePick =
      isPendingSheetPickIndexMessage(text) ||
      (textNorm.length <= 50 && !/\n/.test(textNorm) && !/docs\.google\.com/i.test(textNorm));
    const hasPick = looksLikePick
      ? await hasPendingSheetPick(db, channelUserId).catch(() => false)
      : false;
    if (hasPick) {
      log.info({ channelUserId, textLen: textNorm.length }, "pending sheet pick detected — forcing google_sheets_query");
      return {
        handled: false,
        forceIntent: "google_sheets_query",
        routingTracePatch: { route: "google_sheets_query_pending_pick", used_pending: true, sheet_used: true },
      };
    }
  }

  // タスク参照・リマインダー・タスク管理コマンドも Growth 要望・混乱シグナル時はスキップ
  if (!isGrowthRequest && !isConfusion) {
    const sessionTaskMem = await getSessionMemoryValue<{ items: TaskListItem[] }>(db, channelUserId, "latest_task_list");
    const sessionTaskCreated = await getSessionMemoryValue<{ title: string }>(db, channelUserId, "latest_task_created");

    const directRefNumber = parseTaskTargetNumber(textNorm);
    const looksLikeOnlyReference = directRefNumber != null && /^(?:[1-9][0-9]*\s*(?:番|ばん|つ目|個目)?|一番|いちばん|一つ目|ひとつめ|最初|上のやつ)$/u.test(textNorm);
    if (looksLikeOnlyReference) {
      let items = extractTaskItemsFromAssistantMessages(
        quotedAssistantMessage ? [...(recentAssistantMessages ?? []), quotedAssistantMessage] : (recentAssistantMessages ?? [])
      );
      if (items.length === 0 && sessionTaskMem?.items?.length) {
        items = sessionTaskMem.items;
      }
      const item = items.find((x) => x.number === directRefNumber);
      if (item) {
        return {
          handled: true,
          finalText: `${item.number}番の「${item.title}」ですね。完了・削除・リマインドなど、どうしますか？`,
        };
      }
      return {
        handled: true,
        finalText: "どの一覧の1番か分かりませんでした。",
      };
    }

    const reminderByList = await tryResolveReminderFromRecentTaskList({
      db,
      channelUserId,
      actorUserId: effectiveActorId,
      groupId,
      text,
      recentAssistantMessages,
      quotedAssistantMessage: quotedAssistantMessage ?? undefined,
      inboundMessageId,
      sessionTaskList: sessionTaskMem?.items ?? null,
      sessionLatestTaskTitle: sessionTaskCreated?.title ?? null,
    });
    if (reminderByList.matched) {
      if (reminderByList.mode === "resolved") {
        return {
          handled: false,
          forceIntent: "reminder_request",
          forceRequiredParams: {
            message: reminderByList.title,
            when_description: reminderByList.whenDescription,
            target_number: reminderByList.targetNumber,
          },
        };
      }
      return {
        handled: true,
        finalText: `どのタスクを${reminderByList.whenDescription}にリマインドしますか？番号で教えてください。`,
      };
    }

    const norm = normalizeUserUtterance(text);
    const op = resolveUserOperation({
      text,
      recentUserMessages,
      recentAssistantMessages,
    });
    log.info(
      { rawText: text, normalizedText: norm.compact, resolvedKind: op.kind, confidence: op.confidence, reason: op.reason },
      "utterance resolved"
    );

    if (op.kind === "task.list.sheet") {
      log.info({ channelUserId, reason: op.reason }, "task utterance resolved as task.list.sheet — asking confirmation");
      // スプレッドシート読取前に確認を挟む（いきなり読まない）
      await savePendingSheetPick(
        db,
        channelUserId,
        [
          { id: "SHEETS_CONFIRM_YES", name: "はい、読む" },
          { id: "SHEETS_CONFIRM_NO", name: "キャンセル" },
        ],
        text
      ).catch(() => {});
      return {
        handled: true,
        finalText:
          "スプレッドシートのタスク一覧を確認します。読み込んでよろしいですか？\n\n1. はい、読む\n2. キャンセル",
      };
    }
    if (op.kind === "task.add" && op.extractedText && op.extractedText.length >= 2 && op.confidence >= 0.9) {
      return {
        handled: false,
        forceIntent: "task_create",
        forceRequiredParams: {
          title: op.extractedText,
          semantic_operation: op,
        },
      };
    }
    if (op.kind === "task.list.local") {
      const taskResult = await tryHandleTaskLine({
        db,
        text,
        channelUserId,
        actorUserId: effectiveActorId,
        groupId,
        recentAssistantMessages,
        quotedAssistantMessage: quotedAssistantMessage ?? undefined,
      });
      if (taskResult.handled) {
        await persistTaskLineSessionMemory(taskResult);
        return { handled: true, finalText: taskResult.reply };
      }
    }
    if (op.kind === "task.clarify") {
      if (!env.SEMANTIC_ROUTER_ENABLED) {
        return {
          handled: true,
          finalText: "タスクの追加・一覧確認・削除・更新のどれを行いますか？",
        };
      }
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
        quotedAssistantMessage: quotedAssistantMessage ?? undefined,
      });
      if (taskResult.handled) {
        await persistTaskLineSessionMemory(taskResult);
        return { handled: true, finalText: taskResult.reply };
      }
    }
  } // end !isGrowthRequest && !isConfusion (task/sheet routing)

  if (env.ADMIN_LINE_USER_ID && channelUserId === env.ADMIN_LINE_USER_ID) {
    const cap = await tryHandleImprovementCapsuleAdminLine({ db, adminUserId: channelUserId, text });
    if (cap.handled) {
      return { handled: true, finalText: cap.reply };
    }
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

  // semantic router は LLM ベースの補助判定。
  // 混乱シグナルのみスキップ（Growth 要望は semantic router に通して LLM に判断させる）。
  // Growth 時に semantic が reminder/task 等に誘導しても orchestrator 側でガードする。
  const opForSemantic = !isConfusion
    ? resolveUserOperation({ text, recentUserMessages, recentAssistantMessages })
    : null;

  // semantic router は fallback ではなく補助判定として利用する。
  // deterministic が低信頼/曖昧/文脈依存のときに意味解釈を追加する。
  const shouldRunSemanticAssist =
    !isConfusion &&
    opForSemantic != null &&
    env.SEMANTIC_ROUTER_ENABLED &&
    (
      isGrowthRequest || // Growth 要望は常に semantic にも通す（LLMよりに寄せる）
      opForSemantic.kind === "general.chat" ||
      opForSemantic.kind === "unknown" ||
      opForSemantic.kind === "task.clarify" ||
      opForSemantic.confidence < 0.9 ||
      (opForSemantic.kind === "task.add" && (!opForSemantic.extractedText || opForSemantic.extractedText.trim().length < 2)) ||
      ((opForSemantic.kind === "task.delete" || opForSemantic.kind === "task.update") && opForSemantic.requiresConfirmation === true) ||
      looksLikeContextDependentShortTaskText(text) ||
      isMostlyHiraganaText(text)
    );

  // deterministic で拾い切れない曖昧表現は semantic router で意味解釈する（envで段階的にON）
  if (shouldRunSemanticAssist && opForSemantic != null) {
    const op = opForSemantic;
    const sem = await resolveSemanticOperation({
      db,
      userText: text,
      recentUserMessages: recentUserMessages ?? [],
      recentAssistantMessages: recentAssistantMessages ?? [],
    });
    log.info(
      {
        userText: text,
        deterministic_kind: op.kind,
        deterministic_confidence: op.confidence,
        deterministic_reason: op.reason,
        kind: sem.kind,
        confidence: sem.confidence,
        route_hint: sem.route_hint,
        needs_confirmation: sem.needs_confirmation,
        danger_level: sem.danger_level,
        reason: sem.reason,
      },
      "semantic operation resolved"
    );
    const logSemanticAdopt = (adoptedRoute: string) => {
      log.info(
        {
          rawText: text,
          deterministic_kind: op.kind,
          deterministic_confidence: op.confidence,
          deterministic_reason: op.reason,
          semantic_kind: sem.kind,
          semantic_confidence: sem.confidence,
          semantic_reason: sem.reason,
          adopted_route: adoptedRoute,
          extracted_text: sem.extracted_text,
          target_number: sem.target_number,
          needs_confirmation: sem.needs_confirmation,
        },
        "semantic route adopted"
      );
    };
    if (sem.confidence >= env.SEMANTIC_ROUTER_MIN_CONFIDENCE) {
      if (sem.kind === "task.add" && (!sem.extracted_text || sem.extracted_text.trim().length < 2)) {
        logSemanticAdopt("clarify");
        return {
          handled: true,
          finalText: "追加するタスク内容をもう少し具体的に教えてください。",
        };
      }
      if (sem.kind === "task.list.sheet" || sem.kind === "sheet.query") {
        // リマインド一覧・内部タスクリスト要求は Sheets に流さない
        if (
          turnRes.kind === "internal_reminder_list" ||
          turnRes.kind === "internal_task_list"
        ) {
          logSemanticAdopt("sheets_bypassed_for_reminder_or_internal_task_list");
          // fall through to LLM fallback
        } else {
          // スプレッドシート読取前に確認を挟む
          logSemanticAdopt("google_sheets_query_confirm");
          await savePendingSheetPick(
            db,
            channelUserId,
            [
              { id: "SHEETS_CONFIRM_YES", name: "はい、読む" },
              { id: "SHEETS_CONFIRM_NO", name: "キャンセル" },
            ],
            text
          ).catch(() => {});
          return {
            handled: true,
            finalText:
              "スプレッドシートを確認します。読み込んでよろしいですか？\n\n1. はい、読む\n2. キャンセル",
          };
        }
      }
      if (sem.kind === "calendar.query") {
        logSemanticAdopt("google_calendar_query");
        return {
          handled: false,
          forceIntent: "google_calendar_query",
          forceRequiredParams: {
            semantic_operation: sem,
          },
        };
      }
      if (sem.kind === "memo.save") {
        logSemanticAdopt("memo_save");
        return {
          handled: false,
          forceIntent: "memo_save",
          forceRequiredParams: {
            body: sem.extracted_text ?? text,
            semantic_operation: sem,
          },
        };
      }
      if (sem.kind === "reminder.create") {
        logSemanticAdopt("reminder_request");
        return {
          handled: false,
          forceIntent: "reminder_request",
          forceRequiredParams: {
            message: sem.extracted_text ?? text,
            when_description: sem.when_description ?? undefined,
            target_number: sem.target_number,
            target_label: sem.target_label,
            semantic_operation: sem,
          },
        };
      }
      // Growth 要望の場合は clarify/task 系の semantic 結果を受け取らない
      // （orchestrator の Growth override が reminder/sheets/calendar をガード）
      if (!isGrowthRequest) {
        if (sem.kind === "clarify") {
          logSemanticAdopt("clarify");
          return {
            handled: true,
            finalText: "追加・一覧確認・削除・更新のどれを行いますか？",
          };
        }
        if (sem.kind === "task.delete" && sem.needs_confirmation) {
          logSemanticAdopt("confirm_task_delete");
          return {
            handled: true,
            finalText: "削除対象を確認したいです。削除したいタスク番号、またはタスク名を教えてください。",
          };
        }
        if (sem.kind === "task.update" && sem.needs_confirmation) {
          logSemanticAdopt("confirm_task_update");
          return {
            handled: true,
            finalText: "更新対象を確認したいです。対象のタスク番号、またはタスク名を教えてください。",
          };
        }
        if (sem.kind === "task.add") {
          logSemanticAdopt("task_create");
          return {
            handled: false,
            forceIntent: "task_create",
            forceRequiredParams: {
              title: sem.extracted_text,
              target_number: sem.target_number,
              target_label: sem.target_label,
              semantic_operation: sem,
            },
          };
        }
      } // end !isGrowthRequest task routes
      if (sem.kind === "task.list.local" || sem.kind === "task.delete" || sem.kind === "task.update") {
        const routedText = text;
        const taskResult = await tryHandleTaskLine({
          db,
          text: routedText,
          channelUserId,
          actorUserId: effectiveActorId,
          groupId,
          recentAssistantMessages,
          quotedAssistantMessage: quotedAssistantMessage ?? undefined,
        });
        if (taskResult.handled) {
          logSemanticAdopt("task_line_semantic");
          await persistTaskLineSessionMemory(taskResult);
          return { handled: true, finalText: taskResult.reply };
        }
      }
    }
    logSemanticAdopt("deterministic_fallback_low_conf_or_unhandled");
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
