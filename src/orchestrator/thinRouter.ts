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
  hasPendingSheetPick,
  isPendingSheetPickIndexMessage,
} from "../db/user_sheet_pending_pick_repo.js";
import { normalizeUserUtterance } from "../lib/utteranceNormalizer.js";
import { resolveUserOperation } from "../lib/utteranceResolver.js";
import { resolveSemanticOperation } from "../services/semantic_operation_resolver.js";
import { isTaskManagementCommand, tryHandleTaskLine } from "../services/task_line.js";
import { tryResolveReminderFromRecentTaskList } from "../services/task_reminder_router.js";
import { extractTaskItemsFromAssistantMessages, parseTaskTargetNumber } from "../lib/taskListContext.js";
import {
  isExplicitGrowthDevelopmentRequest,
  isForcedGrowthOrIssueCommand,
  isUserConfusionOrNegationSignal,
} from "../lib/growthExplicitRequest.js";

export type ThinRouterResult =
  | { handled: true; finalText: string }
  | { handled: false; forceIntent?: string; forceRequiredParams?: Record<string, unknown> };

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
}): Promise<ThinRouterResult> {
  const log = getLogger();
  const { db, env, channelUserId, actorUserId, groupId, text, inboundMessageId, lineSourceType, recentUserMessages, recentAssistantMessages, quotedAssistantMessage } = input;

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

  const textNorm = text.normalize("NFKC").trim();

  // ----------------------------------------------------------------
  // Growth 明示要望 / 混乱シグナル: stale pending を一切バイパスする
  // ----------------------------------------------------------------
  const isGrowthRequest = isExplicitGrowthDevelopmentRequest(text) || isForcedGrowthOrIssueCommand(text);
  const isConfusion = isUserConfusionOrNegationSignal(text);
  if (isGrowthRequest) {
    log.info({ channelUserId, textLen: textNorm.length }, "explicit growth request — bypassing stale pending states in thinRouter");
  }
  if (isConfusion) {
    log.info({ channelUserId, textLen: textNorm.length }, "user confusion signal — bypassing stale pending states in thinRouter");
  }

  // スプレッドシート候補選択の保留チェック（タスク管理より先に実行）
  // 「5」「2番」などがタスク文脈に誤爆しないようにするため最優先で確認する
  // Growth 要望・混乱シグナルは pending pick をバイパスする（misroute 防止）
  if (!isGrowthRequest && !isConfusion) {
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
  }

  // タスク参照・リマインダー・タスク管理コマンドも Growth 要望・混乱シグナル時はスキップ
  if (!isGrowthRequest && !isConfusion) {
    const directRefNumber = parseTaskTargetNumber(textNorm);
    const looksLikeOnlyReference = directRefNumber != null && /^(?:[1-9][0-9]*\s*(?:番|ばん|つ目|個目)?|一番|いちばん|一つ目|ひとつめ|最初|上のやつ)$/u.test(textNorm);
    if (looksLikeOnlyReference) {
      const items = extractTaskItemsFromAssistantMessages(
        quotedAssistantMessage ? [...(recentAssistantMessages ?? []), quotedAssistantMessage] : (recentAssistantMessages ?? [])
      );
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
      log.info({ channelUserId, reason: op.reason }, "task utterance resolved as task.list.sheet");
      return { handled: false, forceIntent: "google_sheets_query" };
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
        logSemanticAdopt("google_sheets_query");
        return {
          handled: false,
          forceIntent: "google_sheets_query",
          forceRequiredParams: {
            semantic_operation: sem,
          },
        };
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
