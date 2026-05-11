/**
 * Conversation Turn Resolver
 *
 * ルーティングの最上流で「この発言は何の続きか」を判定する層。
 * pending チェック・正規表現散在ロジックより前に呼び出し、
 * 会話文脈に基づいて優先ルートを決定する。
 *
 * 優先順位:
 *   2. ユーザー混乱・否定・Drive 拒否 → clear_stale_pending
 *   3. リマインド一覧リクエスト        → internal_reminder_list
 *   4. 内部タスクリスト（シート明示なし）→ internal_task_list
 *   5. 直前リマインドの時間変更        → reminder_time_update
 *   -. それ以外                       → none
 */

import type { Db } from "../db/client.js";
import { hasPendingSheetPick } from "../db/user_sheet_pending_pick_repo.js";
import { getSessionMemoryValue } from "../services/conversation_session_memory.js";
import {
  isExplicitInternalTaskListRequest,
  isExplicitReminderListRequest,
  isUserConfusionOrNegationSignal,
} from "./growthExplicitRequest.js";

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

export type ReminderRow = {
  id: number;
  message: string;
  remind_at: string;
};

export type ConversationTurnResolution =
  /** NEAR 内部リマインド一覧を表示 */
  | { kind: "internal_reminder_list" }
  /** NEAR 内部タスクリストを表示（pending pick バイパス） */
  | { kind: "internal_task_list" }
  /**
   * 直前リマインドの時間変更。
   * recentReminders が 1 件 → 即更新。複数 → どれを変えるか確認。
   */
  | {
      kind: "reminder_time_update";
      /** 抽出した新しい時間テキスト（例: "14:00", "14時半"） */
      newTimeText: string;
      /** 直近 45 分以内に作成された pending リマインド（新しい順、最大 5 件） */
      recentReminders: ReminderRow[];
    }
  /** stale pending (Drive/Sheets) を解除して謝罪文を返す */
  | {
      kind: "clear_stale_pending";
      reason: string;
      apologyText: string;
    }
  /** 特別な解決なし → 既存ルーティングに任せる */
  | { kind: "none" };

// ─────────────────────────────────────────────
// 純粋関数: リマインド時間変更テキストの抽出
// ─────────────────────────────────────────────

/**
 * 「やっぱり14:00に変えて」「14時に変更して」「時間を15時にして」など、
 * リマインド時間の変更依頼を検知し、新しい時間テキストを返す。
 * 新規作成の「14時に通知して」は検知しない（変更動詞が必要）。
 * 該当なしは null。
 */
export function extractReminderTimeUpdateText(text: string): string | null {
  const t = text.normalize("NFKC").trim();

  // 「やっぱり/やはり」があれば変更意図とみなす
  const hasYappari = /(やっぱり|やはり)/u.test(t);

  // 変更・修正動詞
  const hasUpdateVerb =
    /(変えて|変える|変更(して|する)?|直して|直す|修正(して|する)?)/u.test(t);

  // 「時間を〇〇に変えて」「リマインドの時間〇〇」などの複合フレーズ
  const hasTimeChangePhrase =
    /(時間|時刻).{0,8}(変え|変更|直し|修正)/u.test(t) ||
    /(リマインド|通知)(の時間|の時刻|時間|を).{0,10}(変え|変更|直し)/u.test(t);

  if (!hasYappari && !hasUpdateVerb && !hasTimeChangePhrase) return null;

  // 時間テキストを抽出（HH:MM, HH時, HH時半, HH時MM分）
  const colonMatch = t.match(/(\d{1,2})[:：](\d{2})/u);
  if (colonMatch) return colonMatch[0];

  const jiMatch = t.match(/(\d{1,2})時(半|(\d{2})分)?/u);
  if (jiMatch) return jiMatch[0];

  return null;
}

// ─────────────────────────────────────────────
// 純粋関数: 元のリマインド日時に新しい時間を適用
// ─────────────────────────────────────────────

/**
 * referenceDate の「日付部分（JST）」を保持しつつ、newTimeText の時刻を適用した UTC 日時を返す。
 * 過去時刻（2 分グレース）または解析不能な場合は null。
 */
export function applyReminderTimeUpdate(
  referenceDate: Date,
  newTimeText: string
): Date | null {
  const t = newTimeText.normalize("NFKC");
  let hour: number | null = null;
  let min = 0;

  const colonMatch = t.match(/(\d{1,2})[:：](\d{2})/u);
  if (colonMatch) {
    hour = parseInt(colonMatch[1]!, 10);
    min = parseInt(colonMatch[2]!, 10);
  } else {
    const jiMatch = t.match(/(\d{1,2})時(半|(\d{2})分)?/u);
    if (jiMatch) {
      hour = parseInt(jiMatch[1]!, 10);
      if (jiMatch[2] === "半") {
        min = 30;
      } else if (jiMatch[3]) {
        min = parseInt(jiMatch[3], 10);
      }
    }
  }

  if (hour === null || hour < 0 || hour > 23 || min < 0 || min > 59) return null;

  // 元の remind_at の JST 日付部分を取得
  const jstParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate);

  const year = parseInt(jstParts.find((p) => p.type === "year")?.value ?? "0", 10);
  const month = parseInt(jstParts.find((p) => p.type === "month")?.value ?? "0", 10);
  const day = parseInt(jstParts.find((p) => p.type === "day")?.value ?? "0", 10);
  if (!year || !month || !day) return null;

  // JST → UTC: UTC = JST − 9h
  const utcMs = Date.UTC(year, month - 1, day, hour, min, 0) - 9 * 60 * 60 * 1000;
  const newDate = new Date(utcMs);

  // 過去時刻は採用しない（2 分のグレース許容）
  if (newDate.getTime() < Date.now() - 2 * 60 * 1000) return null;

  return newDate;
}

// ─────────────────────────────────────────────
// メイン: 会話ターン解決
// ─────────────────────────────────────────────

/**
 * 会話ターンを解決してルーティング優先度を返す。
 * thinRouter の最上流（権限チェックの直後）で呼び出すこと。
 */
export async function resolveConversationTurn(input: {
  db: Db;
  channelUserId: string;
  actorUserId: string;
  text: string;
  recentUserMessages?: string[];
  recentAssistantMessages?: string[];
  quotedAssistantMessage?: string;
}): Promise<ConversationTurnResolution> {
  const { db, channelUserId, actorUserId, text } = input;

  // ──────────────────────────────────────────
  // 優先度2: ユーザー混乱・否定・Drive 拒否
  //   stale pending sheet pick があれば解除して謝罪
  // ──────────────────────────────────────────
  if (isUserConfusionOrNegationSignal(text)) {
    const hadPick = await hasPendingSheetPick(db, channelUserId).catch(() => false);
    if (hadPick) {
      return {
        kind: "clear_stale_pending",
        reason: "user_confusion_or_negation_with_pending_pick",
        apologyText:
          "すみません、直前の案内がズレていました。Drive／スプレッドシートの候補選択は解除しました。\n\n改めて何をお手伝いしましょうか？",
      };
    }
    // pending なし → none でLLMに任せる
    return { kind: "none" };
  }

  // ──────────────────────────────────────────
  // 優先度3: リマインド一覧
  //   Drive/Sheets には絶対に流さない
  // ──────────────────────────────────────────
  if (isExplicitReminderListRequest(text)) {
    return { kind: "internal_reminder_list" };
  }

  // ──────────────────────────────────────────
  // 優先度4: 内部タスクリスト（シート明示なし）
  //   stale pending があれば解除して task routing へ流す
  // ──────────────────────────────────────────
  if (isExplicitInternalTaskListRequest(text)) {
    return { kind: "internal_task_list" };
  }

  // ──────────────────────────────────────────
  // 優先度5: 直前リマインドの時間変更
  //   直近 45 分以内に作成されたリマインドが存在する場合のみ発動
  // ──────────────────────────────────────────
  const updateTimeText = extractReminderTimeUpdateText(text);
  if (updateTimeText) {
    const rows = await db
      .query<ReminderRow>(
        `SELECT id, message, remind_at
         FROM reminders
         WHERE actor_user_id = $1
           AND status = 'pending'
           AND remind_at > now()
           AND created_at > now() - INTERVAL '45 minutes'
         ORDER BY created_at DESC
         LIMIT 5`,
        [actorUserId]
      )
      .then((r) => r.rows)
      .catch((): ReminderRow[] => []);

    if (rows.length > 0) {
      let chosen = rows;
      if (rows.length > 1) {
        const mem = await getSessionMemoryValue<{ id: number }>(db, channelUserId, "latest_reminder_created");
        if (mem && typeof mem.id === "number") {
          const one = rows.filter((r) => r.id === mem.id);
          if (one.length === 1) chosen = one;
        }
      }
      return {
        kind: "reminder_time_update",
        newTimeText: updateTimeText,
        recentReminders: chosen,
      };
    }
    // 直近リマインドなし → fall through (通常の reminder_request ルートへ)
  }

  return { kind: "none" };
}
