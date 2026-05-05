import { pushText } from "../channels/line/client.js";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import {
  notifyCodingReady,
  notifyFinalApproval,
  notifyGrowthComplete,
  notifyGrowthFirstApproval,
  notifyGrowthRejected,
  notifyProgress,
  notifyUserGrowthConsent,
} from "./admin_notification_service.js";
import { recordFunnelStep } from "./growth_funnel_service.js";
import {
  markImplementedComplete,
  setFinalApprovalAndStartCoding,
  setImplementationState,
} from "./approval_service.js";
import { registerCapabilityFromGrowth } from "./capability_sync_service.js";
import { buildFinalCursorPrompt, persistBuiltCursorPrompt } from "./cursor_prompt_builder.js";
import { createCodingRunner } from "./coding_runner.js";
import {
  applyHearingAnswersByKey,
  formatBatchHearingLineMessage,
  hearingAnswersAsJson,
  listHearingQuestionBlocks,
  mergeRequiredInformation,
  parseBatchHearingAnswers,
  seedHearingItems,
} from "./hearing_service.js";

const log = getLogger();

const LINE_PUSH_SAFE = 4700;

export async function upsertAdminSession(db: Db, adminUserId: string, suggestionId: number): Promise<void> {
  await db.query(
    `INSERT INTO growth_admin_sessions (admin_line_user_id, active_suggestion_id, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (admin_line_user_id) DO UPDATE SET
       active_suggestion_id = EXCLUDED.active_suggestion_id,
       updated_at = now()`,
    [adminUserId, suggestionId]
  );
}

async function upsertUserGrowthSession(db: Db, requestingLineUserId: string, suggestionId: number): Promise<void> {
  await db.query(
    `INSERT INTO growth_user_sessions (requesting_line_user_id, active_suggestion_id, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (requesting_line_user_id) DO UPDATE SET
       active_suggestion_id = EXCLUDED.active_suggestion_id,
       updated_at = now()`,
    [requestingLineUserId, suggestionId]
  );
}

async function clearUserGrowthSessionForSuggestion(db: Db, suggestionId: number): Promise<void> {
  await db.query(
    `UPDATE growth_user_sessions SET active_suggestion_id = NULL, updated_at = now()
     WHERE active_suggestion_id = $1`,
    [suggestionId]
  );
}

export async function loadSuggestionBundle(db: Db, suggestionId: number) {
  const r = await db.query(
    `SELECT s.*, u.original_message, u.channel_user_id, u.channel AS user_channel, u.id AS unsupported_request_id
     FROM implementation_suggestions s
     JOIN unsupported_requests u ON u.id = s.unsupported_request_id
     WHERE s.id = $1`,
    [suggestionId]
  );
  return r.rows[0] as Record<string, unknown> | undefined;
}

/** ヒアリング完了 → 管理者へ最終承認依頼 */
export async function completeHearingAndNotifyAdmin(db: Db, suggestionId: number): Promise<void> {
  const r = await setImplementationState(db, suggestionId, "awaiting_final_approval");
  if (!r.ok) {
    log.warn({ suggestionId, err: r.error }, "completeHearingAndNotifyAdmin: state transition failed");
    return;
  }
  await db.query(
    `UPDATE unsupported_requests u
     SET status = 'final_approval_requested', updated_at = now()
     FROM implementation_suggestions s
     WHERE s.id = $1 AND u.id = s.unsupported_request_id`,
    [suggestionId]
  );
  const env = getEnv();
  if (!env.ADMIN_LINE_USER_ID) {
    log.warn({ suggestionId }, "completeHearingAndNotifyAdmin: ADMIN_LINE_USER_ID unset");
    return;
  }
  await upsertAdminSession(db, env.ADMIN_LINE_USER_ID, suggestionId);
  await notifyFinalApproval({
    db,
    adminUserId: env.ADMIN_LINE_USER_ID,
    suggestionId,
  });
}

/** 依頼ユーザーへ一括ヒアリング（設問を1通で送る） */
export async function startUserHearingBatchFlow(db: Db, suggestionId: number): Promise<void> {
  const row = await loadSuggestionBundle(db, suggestionId);
  if (!row) return;
  const userId = String(row.channel_user_id ?? "").trim();
  if (!userId) {
    log.warn({ suggestionId }, "startUserHearingBatchFlow: missing channel_user_id");
    return;
  }

  await seedHearingItems(db, suggestionId, {
    original_message: String(row.original_message ?? ""),
    steps: row.steps,
    summary: String(row.summary ?? ""),
    required_apis: row.required_apis,
    suggested_modules: row.suggested_modules,
    improvement_kind: row.improvement_kind ? String(row.improvement_kind) : null,
    risk_level: row.risk_level ? String(row.risk_level) : null,
  });

  const blocks = await listHearingQuestionBlocks(db, suggestionId);
  if (blocks.length === 0) {
    await completeHearingAndNotifyAdmin(db, suggestionId);
    return;
  }

  const msg = formatBatchHearingLineMessage({
    questions: blocks.map((b) => ({ key: b.key, text: b.text })),
    suggestionId,
  });
  const clipped = msg.length > LINE_PUSH_SAFE ? msg.slice(0, LINE_PUSH_SAFE - 20) + "\n…(省略)" : msg;
  await pushText(userId, clipped);
}

/**
 * 提案レコード作成直後: 依頼ユーザーへ同意確認（管理者より先）。
 * ADMIN_LINE_USER_ID が無くてもユーザー通知は行う。
 */
export async function onSuggestionCreated(db: Db, suggestionId: number): Promise<void> {
  const env = getEnv();
  const row = await loadSuggestionBundle(db, suggestionId);
  if (!row) return;

  const unsupportedRequestId = Number(row.unsupported_request_id);
  const channelUserId = String(row.channel_user_id ?? "").trim();
  const inboundRow = await db.query<{ inbound_message_id: string | null }>(
    `SELECT inbound_message_id::text AS inbound_message_id FROM unsupported_requests WHERE id = $1`,
    [unsupportedRequestId]
  );
  const rawIm = inboundRow.rows[0]?.inbound_message_id;
  const inboundMessageId = rawIm ? Number(rawIm) : null;

  await db.query(
    `UPDATE unsupported_requests
     SET status = 'user_consent_requested', updated_at = now()
     WHERE id = $1`,
    [unsupportedRequestId]
  );

  await db.query(`UPDATE implementation_suggestions SET updated_at = now() WHERE id = $1`, [suggestionId]);

  if (channelUserId) {
    await upsertUserGrowthSession(db, channelUserId, suggestionId);
    try {
      await notifyUserGrowthConsent({
        lineUserId: channelUserId,
        suggestionId,
        userOriginalSnippet: String(row.original_message ?? ""),
        userSummary: String(row.summary ?? ""),
        growthDifficultyTier: row.difficulty != null ? String(row.difficulty) : null,
      });
      await recordFunnelStep(db, {
        step: "user_consent_push_ok",
        unsupportedRequestId,
        inboundMessageId: Number.isFinite(inboundMessageId) ? inboundMessageId : null,
        channel: String(row.user_channel ?? "line"),
        channelUserId,
        reasonCode: "ok",
        detail: { suggestion_id: suggestionId },
      });
    } catch (e) {
      log.warn({ err: e, suggestionId }, "notifyUserGrowthConsent failed");
      await recordFunnelStep(db, {
        step: "user_consent_push_failed",
        unsupportedRequestId,
        inboundMessageId: Number.isFinite(inboundMessageId) ? inboundMessageId : null,
        channel: String(row.user_channel ?? "line"),
        channelUserId,
        reasonCode: "push_exception",
        detail: { suggestion_id: suggestionId },
      });
    }
  } else {
    log.warn({ suggestionId }, "onSuggestionCreated: no channel_user_id; user consent notify skipped");
    await recordFunnelStep(db, {
      step: "user_consent_push_failed",
      unsupportedRequestId,
      inboundMessageId: Number.isFinite(inboundMessageId) ? inboundMessageId : null,
      channel: "line",
      channelUserId: "",
      reasonCode: "no_channel_user_id",
      detail: { suggestion_id: suggestionId },
    });
  }

  const adminDest = env.GROWTH_APPROVAL_GROUP_ID?.trim() || env.ADMIN_LINE_USER_ID?.trim() || "";
  if (env.NEAR_GROWTH_ADMIN_NOTIFY_ON_SUGGESTION && adminDest) {
    try {
      await notifyGrowthFirstApproval({
        db,
        adminUserId: env.ADMIN_LINE_USER_ID?.trim() ?? "",
        suggestionId,
        userSummary: String(row.summary ?? ""),
        userOriginalSnippet: String(row.original_message ?? ""),
      });
      await recordFunnelStep(db, {
        step: "admin_first_approval_push_ok",
        unsupportedRequestId,
        inboundMessageId: Number.isFinite(inboundMessageId) ? inboundMessageId : null,
        channel: String(row.user_channel ?? "line"),
        channelUserId,
        reasonCode: "ok",
        detail: { suggestion_id: suggestionId, has_admin_destination: true },
      });
    } catch (e) {
      log.warn({ err: e, suggestionId }, "notifyGrowthFirstApproval failed");
      await recordFunnelStep(db, {
        step: "admin_first_approval_push_failed",
        unsupportedRequestId,
        inboundMessageId: Number.isFinite(inboundMessageId) ? inboundMessageId : null,
        channel: String(row.user_channel ?? "line"),
        channelUserId,
        reasonCode: "push_exception",
        detail: { suggestion_id: suggestionId },
      });
    }
  } else {
    const reasonCode = env.NEAR_GROWTH_ADMIN_NOTIFY_ON_SUGGESTION
      ? "no_admin_line_or_group"
      : "wait_user_hearing_done";
    await recordFunnelStep(db, {
      step: "admin_first_approval_skipped_no_destination",
      unsupportedRequestId,
      inboundMessageId: Number.isFinite(inboundMessageId) ? inboundMessageId : null,
      channel: String(row.user_channel ?? "line"),
      channelUserId,
      reasonCode,
      detail: { suggestion_id: suggestionId },
    });
  }
}

export async function handleUserConsentAffirmative(db: Db, suggestionId: number): Promise<string> {
  const cur = await db.query<{ implementation_state: string }>(
    `SELECT implementation_state FROM implementation_suggestions WHERE id = $1`,
    [suggestionId]
  );
  const st = cur.rows[0]?.implementation_state;
  if (st !== "awaiting_user_consent") {
    return "いまの状態では、この返信では先に進めません（別の候補が進行中かもしれません）。";
  }

  const r = await setImplementationState(db, suggestionId, "hearing_required");
  if (!r.ok) return "状態の更新に失敗しました。しばらくしてからもう一度お試しください。";

  await db.query(
    `UPDATE unsupported_requests u
     SET status = 'user_hearing_in_progress', updated_at = now()
     FROM implementation_suggestions s
     WHERE s.id = $1 AND u.id = s.unsupported_request_id`,
    [suggestionId]
  );

  await startUserHearingBatchFlow(db, suggestionId);
  return "ありがとうございます。続けて、確認したいことをまとめてお送りします。";
}

export async function handleUserConsentNegative(db: Db, suggestionId: number): Promise<string> {
  await db.query(
    `UPDATE implementation_suggestions
     SET approval_status = 'rejected',
         implementation_state = 'failed',
         failure_reason = COALESCE(failure_reason, '依頼者が成長候補を見送り'),
         updated_at = now()
     WHERE id = $1`,
    [suggestionId]
  );
  await db.query(
    `UPDATE unsupported_requests u
     SET status = 'rejected', updated_at = now()
     FROM implementation_suggestions s
     WHERE s.id = $1 AND u.id = s.unsupported_request_id`,
    [suggestionId]
  );
  await clearUserGrowthSessionForSuggestion(db, suggestionId);
  return "承知しました。この内容での成長候補はここで止めておきます。また何かあればいつでもどうぞ。";
}

export async function handleUserHearingCancel(db: Db, suggestionId: number): Promise<string> {
  await db.query(
    `UPDATE implementation_suggestions
     SET implementation_state = 'failed',
         failure_reason = COALESCE(failure_reason, '依頼者がヒアリングを中断'),
         updated_at = now()
     WHERE id = $1`,
    [suggestionId]
  );
  await db.query(
    `UPDATE unsupported_requests u
     SET status = 'failed', updated_at = now()
     FROM implementation_suggestions s
     WHERE s.id = $1 AND u.id = s.unsupported_request_id`,
    [suggestionId]
  );
  await clearUserGrowthSessionForSuggestion(db, suggestionId);
  return "ヒアリングを中断し、この成長候補を止めました。";
}

/** ユーザーからの1通でヒアリング完了 */
export async function handleUserBatchHearingReply(
  db: Db,
  suggestionId: number,
  userReply: string
): Promise<string> {
  const blocks = await listHearingQuestionBlocks(db, suggestionId);
  if (blocks.length === 0) {
    return "ヒアリング設問が見つかりませんでした。お手数ですが運営までご連絡ください。";
  }
  const answers = await parseBatchHearingAnswers({ questionBlocks: blocks, userReply });
  await applyHearingAnswersByKey(db, suggestionId, answers);
  await mergeRequiredInformation(db, suggestionId, answers);
  await completeHearingAndNotifyAdmin(db, suggestionId);
  return "ありがとうございます。内容を開発担当に共有し、実装前の最終確認を進めます。しばらくお待ちください。";
}

/** 管理APIで第一段階承認した直後など: ユーザーへ一括ヒアリングを送る（レガシー用） */
export async function startHearingFlow(db: Db, _adminUserId: string, suggestionId: number): Promise<void> {
  await startUserHearingBatchFlow(db, suggestionId);
}

export async function handleAdminAffirmativeFinalApproval(
  db: Db,
  adminUserId: string,
  suggestionId: number
): Promise<string> {
  const r = await setFinalApprovalAndStartCoding(db, suggestionId, "approved", null);
  if (!r.ok) return `最終承認に進めませんでした: ${r.error ?? "理由不明"}`;

  const full = await buildFinalCursorPrompt(db, suggestionId);
  await persistBuiltCursorPrompt(db, suggestionId, full);

  const runner = createCodingRunner();
  const run = await runner.onCodingPhaseEntered({ db, suggestionId, cursorPrompt: full });

  await notifyCodingReady({
    db,
    adminUserId,
    suggestionId,
    cursorPrompt: full,
    runnerHint: run.message,
  });

  await notifyProgress({
    db,
    adminUserId,
    suggestionId,
    phase: "coding",
    detail: run.ok ? "コーディングフェーズに入りました。" : "手動対応が必要です。",
  });

  return run.ok
    ? "実装指示をお送りしました。作業後「成長完了」と返信いただくと完了記録に進めます。"
    : "実装指示はお送りしましたが、自動実行側に課題があります。手動で Cursor に貼って進めてください。";
}

export async function handleAdminNegativeFinalApproval(
  db: Db,
  adminUserId: string,
  suggestionId: number
): Promise<string> {
  await setFinalApprovalAndStartCoding(db, suggestionId, "rejected", null);
  await notifyGrowthRejected({
    db,
    adminUserId,
    suggestionId,
    reason: "管理者の最終承認が「いいえ」でした。",
  });
  return "承知しました。ここで止めておきますね。";
}

export async function handleAdminGrowthComplete(db: Db, adminUserId: string, suggestionId: number): Promise<string> {
  const rowBefore = await loadSuggestionBundle(db, suggestionId);
  const r = await markImplementedComplete(db, suggestionId);
  if (!r.ok) return `完了にできませんでした: ${r.error ?? ""}`;

  const row = rowBefore;
  if (row) {
    await registerCapabilityFromGrowth({
      db,
      suggestionId,
      summary: String(row.summary ?? ""),
      suggestedModules: row.suggested_modules,
    });
  }

  await notifyGrowthComplete({
    db,
    adminUserId,
    suggestionId,
    summary: String(row?.summary ?? ""),
    changeOverview: "手動フローで実装・デプロイ済みとしてマークされました。",
    notes: "実際のコード変更内容はリポジトリの差分でご確認ください。",
  });

  return "成長完了として記録しました。ありがとうございました。";
}

export async function resolveSuggestionIdForAdmin(
  db: Db,
  adminUserId: string,
  _text: string,
  explicitId?: number | null
): Promise<number | null> {
  if (explicitId != null && Number.isFinite(explicitId)) return explicitId;
  const s = await db.query<{ active_suggestion_id: string | null }>(
    `SELECT active_suggestion_id FROM growth_admin_sessions WHERE admin_line_user_id = $1`,
    [adminUserId]
  );
  const id = s.rows[0]?.active_suggestion_id;
  return id != null ? Number(id) : null;
}

export async function resolveSuggestionIdForRequestingUser(
  db: Db,
  requestingLineUserId: string,
  explicitId?: number | null
): Promise<number | null> {
  if (explicitId != null && Number.isFinite(explicitId)) return explicitId;
  const s = await db.query<{ active_suggestion_id: string | null }>(
    `SELECT active_suggestion_id FROM growth_user_sessions WHERE requesting_line_user_id = $1`,
    [requestingLineUserId]
  );
  const id = s.rows[0]?.active_suggestion_id;
  return id != null ? Number(id) : null;
}
