import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import {
  notifyCodingReady,
  notifyFinalApproval,
  notifyGrowthComplete,
  notifyGrowthFirstApproval,
  notifyGrowthRejected,
  notifyHearingQuestion,
  notifyProgress,
} from "./admin_notification_service.js";
import {
  markImplementedComplete,
  setFinalApprovalAndStartCoding,
  setFirstApproval,
  setImplementationState,
} from "./approval_service.js";
import { registerCapabilityFromGrowth } from "./capability_sync_service.js";
import { buildFinalCursorPrompt, persistBuiltCursorPrompt } from "./cursor_prompt_builder.js";
import { createCodingRunner } from "./coding_runner.js";
import {
  getNextUnansweredHearing,
  hearingAnswersAsJson,
  mergeRequiredInformation,
  saveHearingAnswer,
  seedHearingItems,
} from "./hearing_service.js";

const log = getLogger();

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

async function loadSuggestionBundle(db: Db, suggestionId: number) {
  const r = await db.query(
    `SELECT s.*, u.original_message, u.channel_user_id
     FROM implementation_suggestions s
     JOIN unsupported_requests u ON u.id = s.unsupported_request_id
     WHERE s.id = $1`,
    [suggestionId]
  );
  return r.rows[0] as Record<string, unknown> | undefined;
}

/** 提案レコード作成直後: unsupported 更新・セッション・第一段階承認のお願い */
export async function onSuggestionCreated(db: Db, suggestionId: number): Promise<void> {
  const env = getEnv();
  if (!env.ADMIN_LINE_USER_ID) {
    log.info({ suggestionId }, "growth: skip admin flow (ADMIN_LINE_USER_ID unset)");
    return;
  }
  const row = await loadSuggestionBundle(db, suggestionId);
  if (!row) return;

  await db.query(
    `UPDATE unsupported_requests
     SET status = 'admin_approval_requested', updated_at = now()
     WHERE id = $1`,
    [row.unsupported_request_id]
  );

  await db.query(
    `UPDATE implementation_suggestions SET updated_at = now() WHERE id = $1`,
    [suggestionId]
  );

  await upsertAdminSession(db, env.ADMIN_LINE_USER_ID, suggestionId);

  await notifyGrowthFirstApproval({
    db,
    adminUserId: env.ADMIN_LINE_USER_ID,
    suggestionId,
    userSummary: String(row.summary ?? ""),
    userOriginalSnippet: String(row.original_message ?? ""),
  });
}

export async function startHearingFlow(db: Db, adminUserId: string, suggestionId: number): Promise<void> {
  const row = await loadSuggestionBundle(db, suggestionId);
  if (!row) return;
  await seedHearingItems(db, suggestionId, {
    summary: String(row.summary ?? ""),
    required_apis: row.required_apis,
    suggested_modules: row.suggested_modules,
    improvement_kind: row.improvement_kind ? String(row.improvement_kind) : null,
    risk_level: row.risk_level ? String(row.risk_level) : null,
  });

  const next = await getNextUnansweredHearing(db, suggestionId);
  if (!next) {
    await setImplementationState(db, suggestionId, "awaiting_final_approval");
    await notifyFinalApproval({ adminUserId, suggestionId });
    return;
  }
  await notifyHearingQuestion({
    adminUserId,
    suggestionId,
    questionText: next.question_text,
  });
}

export async function handleAdminAffirmativeFirstApproval(
  db: Db,
  adminUserId: string,
  suggestionId: number
): Promise<string> {
  const r = await setFirstApproval(db, suggestionId, "approved", null);
  if (!r.ok) return "すでに第一段階は決まっているか、提案が見つかりませんでした。";
  await startHearingFlow(db, adminUserId, suggestionId);
  return ""; // 通知で返すので空
}

export async function handleAdminNegativeFirstApproval(
  db: Db,
  adminUserId: string,
  suggestionId: number
): Promise<string> {
  await setFirstApproval(db, suggestionId, "rejected", null);
  await notifyGrowthRejected({
    adminUserId,
    suggestionId,
    reason: "第一段階承認が「いいえ」でした。",
  });
  return "承知しました。この成長候補は見送りにしますね。";
}

export async function handleHearingReply(
  db: Db,
  adminUserId: string,
  suggestionId: number,
  answer: string
): Promise<string> {
  const next = await getNextUnansweredHearing(db, suggestionId);
  if (!next) {
    await notifyFinalApproval({ adminUserId, suggestionId });
    return "ヒアリングは完了済みのようです。最終承認のご返信をお待ちしています。";
  }
  await saveHearingAnswer(db, next.id, answer);
  const answers = await hearingAnswersAsJson(db, suggestionId);
  await mergeRequiredInformation(db, suggestionId, answers);

  const following = await getNextUnansweredHearing(db, suggestionId);
  if (following) {
    await notifyHearingQuestion({
      adminUserId,
      suggestionId,
      questionText: following.question_text,
    });
    return "ありがとうございます。続けてこちらも教えてください（プッシュしました）。";
  }
  await setImplementationState(db, suggestionId, "awaiting_final_approval");
  await db.query(
    `UPDATE unsupported_requests u
     SET status = 'final_approval_requested', updated_at = now()
     FROM implementation_suggestions s
     WHERE s.id = $1 AND u.id = s.unsupported_request_id`,
    [suggestionId]
  );
  await notifyFinalApproval({ adminUserId, suggestionId });
  return "必要な情報がそろいました。最終承認のメッセージをお送りします。";
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
    adminUserId,
    suggestionId,
    cursorPrompt: full,
    runnerHint: run.message,
  });

  await notifyProgress({
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
    adminUserId,
    suggestionId,
    reason: "第二段階承認が「いいえ」でした。",
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
