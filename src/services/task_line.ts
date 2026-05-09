/**
 * タスク管理のキーワードコマンドハンドラー
 * thinRouter から呼び出す（LLM を通さずに処理）
 *
 * 対応コマンド:
 *   タスク一覧 / タスクリスト / 今のタスク
 *   タスク完了 N  / N番完了  / 全部完了 / 両方完了
 *   タスク削除 N  / N番削除  / 全部削除 / 両方削除 / 二つとも削除
 *   タスク編集 N 新しいタイトル
 *
 * 会話コンテキスト判定:
 *   直前の NEAR 返答がタスク一覧だった場合、「削除して」「両方消して」なども受け付ける
 */

import type { Db } from "../db/client.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger();

type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  task_scope: string;
  actor_user_id: string | null;
  created_at: Date;
};

// ─── コマンド判定 ─────────────────────────────────────────────────────────────

const LIST_RE =
  /タスク(?:一覧|リスト|みせて|見せて|教えて|確認|一覧出して)|(?:今の|今日の|現在の)?タスク(?:一覧|リスト)|タスクは(?:何|なん)|タスク出して/u;

// 番号指定（1件）
const DONE_RE =
  /(?:タスク)?(?:完了|終わった|終了|やった|できた|done)[^\d０-９]*([1-9０-９][0-9０-９]?)(?:番)?|([1-9０-９][0-9０-９]?)番(?:目)?(?:のタスク)?(?:完了|終了|やった|done)/iu;
const DELETE_RE =
  /(?:タスク)?(?:削除|消して|消去|delete)[^\d０-９]*([1-9０-９][0-9０-９]?)番?|([1-9０-９][0-9０-９]?)番(?:目)?(?:のタスク)?(?:削除|消して)/iu;
const EDIT_RE = /タスク(?:編集|変更|修正)[^\d０-９]*([1-9０-９][0-9０-９]?)番?\s+(.+)/u;

// 一括操作（全部・両方・二つとも・すべて）
const ALL_DELETE_RE =
  /(?:全部|全て|すべて|両方|二つとも|ぜんぶ|全タスク)(?:を)?(?:削除|消して|消去|delete)|(?:削除|消して|消去)(?:して)?(?:全部|全て|すべて|両方|二つとも)/iu;
const ALL_DONE_RE =
  /(?:全部|全て|すべて|両方|二つとも|ぜんぶ|全タスク)(?:を)?(?:完了|終わった|終了|やった|done)|(?:完了|終了)(?:して)?(?:全部|全て|すべて|両方|二つとも)/iu;

// 直前の NEAR 返答がタスク一覧だったときに追加で認識するパターン
// 例: 「二つとも削除して」「両方消して」「全部やった」（タスク文脈を前提）
const CONTEXT_DELETE_RE =
  /(?:両方|二つとも|全部|全て|すべて|ぜんぶ)(?:とも)?(?:を)?(?:削除|消して|消去)|(?:削除|消して)/iu;
const CONTEXT_DONE_RE =
  /(?:両方|二つとも|全部|全て|すべて|ぜんぶ)(?:とも)?(?:を)?(?:完了|終わった|終了|やった)/iu;

/** 直前の NEAR 発言がタスク一覧かどうか */
function hadRecentTaskListReply(recentAssistantMessages: string[]): boolean {
  return recentAssistantMessages.some((m) => /📋\s*タスク一覧/.test(m));
}

function toHalfNum(s: string): number {
  return parseInt(s.normalize("NFKC"), 10);
}

export function isTaskManagementCommand(
  text: string,
  recentAssistantMessages?: string[]
): boolean {
  const t = text.normalize("NFKC");
  if (LIST_RE.test(t) || DONE_RE.test(t) || DELETE_RE.test(t) || EDIT_RE.test(t)) return true;
  if (ALL_DELETE_RE.test(t) || ALL_DONE_RE.test(t)) return true;
  // タスク一覧の直後なら短い「削除して」「両方消して」も受け付ける
  if (recentAssistantMessages && hadRecentTaskListReply(recentAssistantMessages)) {
    if (CONTEXT_DELETE_RE.test(t) || CONTEXT_DONE_RE.test(t)) return true;
  }
  return false;
}

// ─── タスク取得ヘルパー ──────────────────────────────────────────────────────

async function fetchActiveTasks(
  db: Db,
  channelUserId: string,
  groupId: string | undefined,
  actorUserId: string
): Promise<TaskRow[]> {
  // グループ: groupタスク(全員共有) + 自分のpersonalタスク
  // 個人: 自分のpersonalタスクのみ
  if (groupId) {
    const r = await db.query<TaskRow>(
      `SELECT id, title, notes, status, task_scope, actor_user_id, created_at
       FROM tasks
       WHERE status = 'open'
         AND (
           (group_id = $1 AND task_scope = 'group')
           OR
           (actor_user_id = $2 AND task_scope = 'personal' AND group_id = $1)
         )
       ORDER BY created_at ASC
       LIMIT 30`,
      [groupId, actorUserId]
    );
    return r.rows;
  } else {
    const r = await db.query<TaskRow>(
      `SELECT id, title, notes, status, task_scope, actor_user_id, created_at
       FROM tasks
       WHERE status = 'open'
         AND channel_user_id = $1
         AND task_scope = 'personal'
       ORDER BY created_at ASC
       LIMIT 30`,
      [channelUserId]
    );
    return r.rows;
  }
}

function formatTaskList(tasks: TaskRow[], groupId?: string): string {
  if (tasks.length === 0) {
    return groupId
      ? "現在、オープンなタスクはありません（グループ共有 + あなたの個人タスク）。"
      : "現在、オープンなタスクはありません。";
  }
  const lines = tasks.map((t, i) => {
    const scope = t.task_scope === "group" ? "【共有】" : "【個人】";
    const note = t.notes ? `（${t.notes}）` : "";
    return `${i + 1}. ${scope} ${t.title}${note}`;
  });
  const header = groupId
    ? `📋 タスク一覧（${tasks.length}件 / 共有＋あなたの個人）:`
    : `📋 タスク一覧（${tasks.length}件）:`;
  return `${header}\n\n${lines.join("\n")}\n\n完了: 「タスク完了 1」  削除: 「タスク削除 1」`;
}

// ─── メインハンドラー ─────────────────────────────────────────────────────────

export async function tryHandleTaskLine(input: {
  db: Db;
  text: string;
  channelUserId: string;
  actorUserId: string;
  groupId?: string;
  recentAssistantMessages?: string[];
}): Promise<{ handled: boolean; reply: string }> {
  const { db, channelUserId, actorUserId, groupId, recentAssistantMessages = [] } = input;
  const t = input.text.normalize("NFKC").trim();
  const inTaskContext = hadRecentTaskListReply(recentAssistantMessages);

  // ─ 一括削除（全部・両方・二つとも）─
  const isAllDelete =
    ALL_DELETE_RE.test(t) ||
    (inTaskContext && CONTEXT_DELETE_RE.test(t) && !DELETE_RE.test(t));
  if (isAllDelete) {
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      if (tasks.length === 0) {
        return { handled: true, reply: "削除するタスクがありません。" };
      }
      const ids = tasks.map((t) => t.id);
      await db.query(`DELETE FROM tasks WHERE id = ANY($1::bigint[])`, [ids]);
      const titles = tasks.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
      log.info({ count: ids.length, actorUserId }, "all tasks deleted");
      return { handled: true, reply: `🗑️ ${tasks.length}件のタスクをすべて削除しました。\n\n${titles}` };
    } catch (e) {
      log.error({ err: e }, "task all-delete failed");
      return { handled: true, reply: "タスクの削除中にエラーが発生しました。" };
    }
  }

  // ─ 一括完了（全部・両方・二つとも）─
  const isAllDone =
    ALL_DONE_RE.test(t) ||
    (inTaskContext && CONTEXT_DONE_RE.test(t) && !DONE_RE.test(t));
  if (isAllDone) {
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      if (tasks.length === 0) {
        return { handled: true, reply: "完了するタスクがありません。" };
      }
      const ids = tasks.map((t) => t.id);
      await db.query(`UPDATE tasks SET status = 'done', updated_at = now() WHERE id = ANY($1::bigint[])`, [ids]);
      const titles = tasks.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
      log.info({ count: ids.length, actorUserId }, "all tasks marked done");
      return { handled: true, reply: `✅ ${tasks.length}件のタスクをすべて完了にしました。\n\n${titles}` };
    } catch (e) {
      log.error({ err: e }, "task all-done failed");
      return { handled: true, reply: "タスクの更新中にエラーが発生しました。" };
    }
  }

  // ─ 一覧 ─
  if (LIST_RE.test(t)) {
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      return { handled: true, reply: formatTaskList(tasks, groupId) };
    } catch (e) {
      log.error({ err: e }, "task list failed");
      return { handled: true, reply: "タスクの取得中にエラーが発生しました。" };
    }
  }

  // ─ 完了（番号指定）─
  const doneMatch = t.match(DONE_RE);
  if (doneMatch) {
    const numStr = doneMatch[1] ?? doneMatch[2] ?? "";
    const idx = toHalfNum(numStr) - 1;
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      const target = tasks[idx];
      if (!target) {
        return { handled: true, reply: `1〜${tasks.length} の番号を指定してください（例: 「タスク完了 1」）。` };
      }
      await db.query(
        `UPDATE tasks SET status = 'done', updated_at = now() WHERE id = $1`,
        [target.id]
      );
      log.info({ taskId: target.id, actorUserId }, "task marked done");
      return { handled: true, reply: `✅ 「${target.title}」を完了にしました。` };
    } catch (e) {
      log.error({ err: e }, "task done failed");
      return { handled: true, reply: "タスクの更新中にエラーが発生しました。" };
    }
  }

  // ─ 削除（番号指定）─
  const deleteMatch = t.match(DELETE_RE);
  if (deleteMatch) {
    const numStr = deleteMatch[1] ?? deleteMatch[2] ?? "";
    const idx = toHalfNum(numStr) - 1;
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      const target = tasks[idx];
      if (!target) {
        return { handled: true, reply: `1〜${tasks.length} の番号を指定してください（例: 「タスク削除 1」）。` };
      }
      await db.query(`DELETE FROM tasks WHERE id = $1`, [target.id]);
      log.info({ taskId: target.id, actorUserId }, "task deleted");
      return { handled: true, reply: `🗑️ 「${target.title}」を削除しました。` };
    } catch (e) {
      log.error({ err: e }, "task delete failed");
      return { handled: true, reply: "タスクの削除中にエラーが発生しました。" };
    }
  }

  // ─ 編集 ─
  const editMatch = t.match(EDIT_RE);
  if (editMatch) {
    const numStr = editMatch[1] ?? "";
    const newTitle = editMatch[2]?.trim() ?? "";
    const idx = toHalfNum(numStr) - 1;
    if (!newTitle) {
      return { handled: true, reply: "新しいタイトルを指定してください。\n例: 「タスク編集 1 新しいタイトル」" };
    }
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      const target = tasks[idx];
      if (!target) {
        return { handled: true, reply: `1〜${tasks.length} の番号を指定してください。` };
      }
      await db.query(
        `UPDATE tasks SET title = $1, updated_at = now() WHERE id = $2`,
        [newTitle, target.id]
      );
      log.info({ taskId: target.id, actorUserId }, "task edited");
      return { handled: true, reply: `✏️ 「${target.title}」→「${newTitle}」に変更しました。` };
    } catch (e) {
      log.error({ err: e }, "task edit failed");
      return { handled: true, reply: "タスクの編集中にエラーが発生しました。" };
    }
  }

  return { handled: false, reply: "" };
}
