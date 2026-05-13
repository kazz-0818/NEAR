/**
 * タスク管理のキーワードコマンドハンドラー
 * thinRouter から呼び出す（LLM を通さずに処理）
 *
 * 対応コマンド:
 *   タスク一覧 / タスクリスト / 今のタスク / やること一覧 など
 *   〇〇をタスクに追加 / タスク追加：タイトル
 *   タスク完了 N  / N番完了  / 番号なし完了（1件時は即完了）/ 全部完了 / 両方完了
 *   タスク削除 N  / N番削除  / 番号なし削除（1件時は即削除）/ 全部削除 / 二つとも削除 など
 *   タスク編集 N 新しいタイトル
 *   一覧直後:「最初のやつ」「一番上」
 *
 * 会話コンテキスト判定:
 *   直前の NEAR 返答がタスク一覧だった場合、「削除して」「両方消して」なども受け付ける
 */

import type { Db } from "../db/client.js";
import { getLogger } from "../lib/logger.js";
import { resolveUserOperation } from "../lib/utteranceResolver.js";
import { extractTaskItemsFromAssistantMessages } from "../lib/taskListContext.js";
import type { SessionMemoryType } from "./conversation_session_memory.js";

const log = getLogger();

export type TaskLineSessionMemoryWrite = {
  memoryType: SessionMemoryType;
  value: unknown;
  ttlMinutes: number;
};

export type TaskLineResult = {
  handled: boolean;
  reply: string;
  sessionMemoryWrite?: TaskLineSessionMemoryWrite;
};

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
  /タスク(?:一覧|リスト|みせて|見せて|教えて|確認|一覧出して|ある\??|あります\??|どんなの|何がある|見たい|チェック)|(?:今の|今日の|現在の)?タスク(?:一覧|リスト)|タスクは(?:何|なん)|タスク出して|やること(?:一覧|リスト|みせて|見せて|教えて|確認|ある\??)/u;

// 番号指定（1件）
// パターン1: 動詞が先「削除 2」「完了 2」
// パターン2: 番号が先「2番削除」「2削除して」「2を消して」
const DONE_RE = /(?:タスク\s*)?(?:完了|終わった|終了|やった|できた|done)\s*([1-9０-９][0-9０-９]?)番?|([1-9０-９][0-9０-９]?)(?:番目?|つ目|個目)?\s*(?:の(?:タスク)?)?\s*(?:を|は)?\s*(?:完了|終わった|終了|やった|できた|done)/iu;
const DELETE_RE = /(?:タスク\s*)?(?:削除|消して|消去|delete)\s*([1-9０-９][0-9０-９]?)番?|([1-9０-９][0-9０-９]?)(?:番目?|つ目|個目)?\s*(?:の(?:タスク)?)?\s*(?:を|は)?\s*(?:削除|消して|消去|delete)/iu;
const EDIT_RE = /タスク(?:編集|変更|修正)[^\d０-９]*([1-9０-９][0-9０-９]?)番?\s+(.+)/u;
const TITLE_UPDATE_RE =
  /([1-9０-９][0-9０-９]?)(?:番目?|つ目|個目)?(?:の)?(?:タスク名|タイトル|名前)(?:を)?\s*[「"]?(.+?)[」"]?\s*(?:に変更|にして|へ変更|へ|へ更新)/u;
const TITLE_UPDATE_SHORT_RE =
  /([1-9０-９][0-9０-９]?)(?:番目?|つ目|個目)?(?:を|は)?\s*[「"]?(.+?)[」"]?\s*(?:に変更|にして|へ変更|へ更新)/u;
const NOTE_UPDATE_RE =
  /([1-9０-９][0-9０-９]?)(?:番目?|つ目|個目)?(?:の)?(?:メモ|備考|ノート)(?:を)?\s*[「"]?(.+?)[」"]?\s*(?:に変更|に更新|にして|へ変更|へ更新|に追記)/u;

// タスク一覧の後に「2番」「2」だけ送った場合の文脈選択
const CONTEXT_NUM_ONLY_RE = /^([1-9０-９][0-9０-９]?)(?:番目?|つ目)?$/u;

// 一括操作（全部・両方・二つとも・すべて）
const ALL_DELETE_RE =
  /(?:全部|全て|すべて|両方|二つとも|ぜんぶ|全タスク)(?:を)?(?:削除|消して|消去|delete)|(?:削除|消して|消去)(?:して)?(?:全部|全て|すべて|両方|二つとも)|全消し|全削除/iu;
const ALL_DONE_RE =
  /(?:全部|全て|すべて|両方|二つとも|ぜんぶ|全タスク)(?:を)?(?:完了|終わった|終了|やった|done)|(?:完了|終了)(?:して)?(?:全部|全て|すべて|両方|二つとも)/iu;

// 直前の NEAR 返答がタスク一覧だったときに追加で認識するパターン
// 例: 「二つとも削除して」「両方消して」「全部やった」（タスク文脈を前提）
const CONTEXT_DELETE_RE =
  /(?:両方|二つとも|全部|全て|すべて|ぜんぶ)(?:とも)?(?:を)?(?:削除|消して|消去)/iu;
const CONTEXT_DONE_RE =
  /(?:両方|二つとも|全部|全て|すべて|ぜんぶ)(?:とも)?(?:を)?(?:完了|終わった|終了|やった)/iu;

// 番号なし削除（タスクが1件 or 文脈あり）
const DELETE_NO_NUM_RE =
  /^(?:タスク(?:を)?)?(?:削除|消して|消去)(?:して)?$/iu;

// 番号なし完了（タスクが1件 or 文脈あり）
const DONE_NO_NUM_RE =
  /^(?:タスク(?:を)?)?(?:完了|終わった|終了|やった|できた)(?:にして)?$/iu;

// タスク追加
const ADD_RE =
  /(?:(.+?)(?:を|を?))?タスク(?:リスト)?(?:に)?(?:追加|入れて|登録|追加して|加えて)|(?:(.+?)(?:を|を?))?やること(?:リスト)?(?:に)?(?:追加|入れて|登録)|タスク追加[：:]\s*(.+)/u;

// 「最初のやつ」「一番上」→ インデックス1として扱う
const CONTEXT_FIRST_RE = /^(?:最初|一番上|いちばん上|1番目|一番目|先頭)(?:の(?:やつ|タスク|の)?)?$/u;

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
  const t = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  const op = resolveUserOperation({ text, recentAssistantMessages });
  if (op.kind.startsWith("task.")) return true;
  if (LIST_RE.test(t) || DONE_RE.test(t) || DELETE_RE.test(t) || EDIT_RE.test(t)) return true;
  if (TITLE_UPDATE_RE.test(t) || TITLE_UPDATE_SHORT_RE.test(t) || NOTE_UPDATE_RE.test(t)) return true;
  if (ALL_DELETE_RE.test(t) || ALL_DONE_RE.test(t)) return true;
  // タスク一覧の直後なら「削除して」「両方消して」「2番」だけの発言も受け付ける
  if (recentAssistantMessages && hadRecentTaskListReply(recentAssistantMessages)) {
    if (CONTEXT_DELETE_RE.test(t) || CONTEXT_DONE_RE.test(t)) return true;
    if (CONTEXT_NUM_ONLY_RE.test(t)) return true;
    if (CONTEXT_FIRST_RE.test(t)) return true;
  }
  if (ADD_RE.test(t)) return true;
  if (DELETE_NO_NUM_RE.test(t)) return true;
  if (DONE_NO_NUM_RE.test(t)) return true;
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
       FROM near_tasks
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
       FROM near_tasks
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
  quotedAssistantMessage?: string;
}): Promise<TaskLineResult> {
  const { db, channelUserId, actorUserId, groupId, recentAssistantMessages = [], quotedAssistantMessage } = input;
  const t = input.text.normalize("NFKC").replace(/\s+/g, " ").trim();
  const inTaskContext = hadRecentTaskListReply(recentAssistantMessages);
  const contextMessages = quotedAssistantMessage
    ? [...recentAssistantMessages, quotedAssistantMessage]
    : recentAssistantMessages;
  const contextItems = extractTaskItemsFromAssistantMessages(contextMessages);
  const op = resolveUserOperation({ text: input.text, recentAssistantMessages });

  // タスク読み取りは near_read_task_sheet / sheets 側に任せる
  if (op.kind === "task.list.sheet") {
    return { handled: false, reply: "" };
  }
  if (op.kind === "task.clarify") {
    return { handled: true, reply: "タスクの追加・一覧確認・削除・更新のどれを行いますか？" };
  }

  const deleteNeedConfirm =
    op.kind === "task.delete" &&
    (op.requiresConfirmation === true || !op.targetNumber);
  const updateNeedConfirm =
    op.kind === "task.update" &&
    op.requiresConfirmation === true;

  // ─ タスク追加 ─
  const addMatch = t.match(ADD_RE);
  if (addMatch) {
    const title = (op.extractedText ?? addMatch[1] ?? addMatch[2] ?? addMatch[3] ?? "").trim();
    if (!title) {
      return { handled: true, reply: "追加するタスクのタイトルを教えてください。\n例: 「〇〇をタスクに追加して」" };
    }
    const taskScope = groupId ? "group" : "personal";
    try {
      const ins = await db.query<{ id: string }>(
        `INSERT INTO near_tasks (channel, channel_user_id, actor_user_id, group_id, task_scope, title, notes, status, created_at, updated_at)
         VALUES ('line', $1, $2, $3, $4, $5, NULL, 'open', now(), now())
         RETURNING id::text`,
        [channelUserId, actorUserId, groupId ?? null, taskScope, title]
      );
      const taskId = ins.rows[0]?.id ?? "";
      log.info({ title, actorUserId }, "task added");
      return {
        handled: true,
        reply: `✅ 「${title}」をタスクに追加しました。`,
        sessionMemoryWrite: {
          memoryType: "latest_task_created",
          value: { id: taskId, title },
          ttlMinutes: 120,
        },
      };
    } catch (e) {
      log.error({ err: e }, "task add failed");
      return { handled: true, reply: "タスクの追加中にエラーが発生しました。" };
    }
  }

  // ─ 編集（明示的な更新文）─
  const noteMatch = t.match(NOTE_UPDATE_RE);
  if (noteMatch) {
    const idx = toHalfNum(noteMatch[1] ?? "") - 1;
    const newNote = (noteMatch[2] ?? "").trim();
    if (!newNote) {
      return { handled: true, reply: "新しいメモ内容を指定してください。" };
    }
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      let target: TaskRow | undefined = tasks[idx];
      if (!target && contextItems[idx]) {
        target = tasks.find((row) => row.title === contextItems[idx]!.title);
      }
      if (!target) {
        return { handled: true, reply: `1〜${tasks.length} の番号を指定してください。` };
      }
      await db.query(`UPDATE near_tasks SET notes = $1, updated_at = now() WHERE id = $2`, [newNote, target.id]);
      return { handled: true, reply: `✏️ 「${target.title}」のメモを更新しました。` };
    } catch (e) {
      log.error({ err: e }, "task note update failed");
      return { handled: true, reply: "タスクの編集中にエラーが発生しました。" };
    }
  }

  const titleMatch = t.match(TITLE_UPDATE_RE) ?? t.match(TITLE_UPDATE_SHORT_RE);
  if (titleMatch) {
    const idx = toHalfNum(titleMatch[1] ?? "") - 1;
    const newTitle = (titleMatch[2] ?? "").trim();
    if (!newTitle || /(完了|削除|消して|全部|全て)/u.test(newTitle)) {
      return { handled: true, reply: "新しいタスク名を具体的に教えてください。\n例: 「1番の名前を見積書作成に変更」" };
    }
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      let target: TaskRow | undefined = tasks[idx];
      if (!target && contextItems[idx]) {
        target = tasks.find((row) => row.title === contextItems[idx]!.title);
      }
      if (!target) {
        return { handled: true, reply: `1〜${tasks.length} の番号を指定してください。` };
      }
      await db.query(
        `UPDATE near_tasks SET title = $1, updated_at = now() WHERE id = $2`,
        [newTitle, target.id]
      );
      log.info({ taskId: target.id, actorUserId }, "task title updated");
      return { handled: true, reply: `✏️ 「${target.title}」→「${newTitle}」に変更しました。` };
    } catch (e) {
      log.error({ err: e }, "task title update failed");
      return { handled: true, reply: "タスクの編集中にエラーが発生しました。" };
    }
  }

  if (deleteNeedConfirm) {
    return {
      handled: true,
      reply: "どのタスクを削除するか確認したいです。削除したいタスク番号、またはタスク名を教えてください。",
    };
  }
  if (updateNeedConfirm) {
    return {
      handled: true,
      reply: "どのタスクを更新するか確認したいです。対象のタスク番号、またはタスク名を教えてください。",
    };
  }
  if (op.kind === "task.delete" && /[1-9][0-9]?(?:番)?も\s*(?:消して|削除|消去)/u.test(t) && !inTaskContext) {
    return {
      handled: true,
      reply: "どのタスクを削除するか確認したいです。削除したいタスク番号、またはタスク名を教えてください。",
    };
  }

  // ─ 削除（番号なし）─ タスクが1件なら即削除、複数なら一覧で確認（一括削除より先）
  if (DELETE_NO_NUM_RE.test(t)) {
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      if (tasks.length === 0) {
        return { handled: true, reply: "削除するタスクがありません。" };
      }
      if (tasks.length === 1) {
        await db.query(`DELETE FROM near_tasks WHERE id = $1`, [tasks[0]!.id]);
        log.info({ taskId: tasks[0]!.id, actorUserId }, "task deleted (no-num)");
        return { handled: true, reply: `🗑️ 「${tasks[0]!.title}」を削除しました。` };
      }
      return { handled: true, reply: formatTaskList(tasks, groupId) + "\n\nどれを削除しますか？番号を送ってください。" };
    } catch (e) {
      log.error({ err: e }, "task delete no-num failed");
      return { handled: true, reply: "タスクの削除中にエラーが発生しました。" };
    }
  }

  // ─ 完了（番号なし）─ タスクが1件なら即完了、複数なら一覧で確認
  if (DONE_NO_NUM_RE.test(t)) {
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      if (tasks.length === 0) {
        return { handled: true, reply: "完了するタスクがありません。" };
      }
      if (tasks.length === 1) {
        await db.query(`UPDATE near_tasks SET status = 'done', updated_at = now() WHERE id = $1`, [tasks[0]!.id]);
        log.info({ taskId: tasks[0]!.id, actorUserId }, "task done (no-num)");
        return { handled: true, reply: `✅ 「${tasks[0]!.title}」を完了にしました。` };
      }
      return { handled: true, reply: formatTaskList(tasks, groupId) + "\n\nどれを完了にしますか？番号を送ってください。" };
    } catch (e) {
      log.error({ err: e }, "task done no-num failed");
      return { handled: true, reply: "タスクの更新中にエラーが発生しました。" };
    }
  }

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
      await db.query(`DELETE FROM near_tasks WHERE id = ANY($1::bigint[])`, [ids]);
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
      await db.query(`UPDATE near_tasks SET status = 'done', updated_at = now() WHERE id = ANY($1::bigint[])`, [ids]);
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
      const items = tasks.map((row, i) => ({
        number: i + 1,
        title: row.title,
        id: row.id,
        scope: row.task_scope,
      }));
      return {
        handled: true,
        reply: formatTaskList(tasks, groupId),
        sessionMemoryWrite: {
          memoryType: "latest_task_list",
          value: { items },
          ttlMinutes: 120,
        },
      };
    } catch (e) {
      log.error({ err: e }, "task list failed");
      return { handled: true, reply: "タスクの取得中にエラーが発生しました。" };
    }
  }

  // ─ 「最初のやつ」「一番上」→ インデックス1として扱う ─
  if (inTaskContext && CONTEXT_FIRST_RE.test(t)) {
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      const target = tasks[0];
      if (!target) {
        return { handled: true, reply: "タスクがありません。" };
      }
      return {
        handled: true,
        reply: `「${target.title}」について何をしますか？\n\n・完了 → 「タスク完了 1」\n・削除 → 「タスク削除 1」`,
      };
    } catch (e) {
      return { handled: false, reply: "" };
    }
  }

  // ─ タスク文脈中に数字だけ送られた場合（「2番」「2」）→ 一覧を再表示してガイド ─
  if (inTaskContext && CONTEXT_NUM_ONLY_RE.test(t)) {
    const numStr = t.match(CONTEXT_NUM_ONLY_RE)?.[1] ?? "";
    const idx = toHalfNum(numStr) - 1;
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      let target: TaskRow | undefined = tasks[idx];
      if (!target && contextItems[idx]) {
        target = tasks.find((row) => row.title === contextItems[idx]!.title);
      }
      if (!target) {
        return { handled: true, reply: `1〜${tasks.length} の番号を指定してください。` };
      }
      return {
        handled: true,
        reply: `「${target.title}」について何をしますか？\n\n・完了 → 「タスク完了 ${idx + 1}」\n・削除 → 「タスク削除 ${idx + 1}」`,
      };
    } catch (e) {
      return { handled: false, reply: "" };
    }
  }

  // ─ 完了（番号指定）─
  const doneMatch = t.match(DONE_RE);
  if (doneMatch) {
    const numStr = doneMatch[1] ?? doneMatch[2] ?? "";
    const idx = toHalfNum(numStr) - 1;
    try {
      const tasks = await fetchActiveTasks(db, channelUserId, groupId, actorUserId);
      let target: TaskRow | undefined = tasks[idx];
      if (!target && contextItems[idx]) {
        target = tasks.find((row) => row.title === contextItems[idx]!.title);
      }
      if (!target) {
        return { handled: true, reply: `1〜${tasks.length} の番号を指定してください（例: 「タスク完了 1」）。` };
      }
      await db.query(
        `UPDATE near_tasks SET status = 'done', updated_at = now() WHERE id = $1`,
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
      let target: TaskRow | undefined = tasks[idx];
      if (!target && contextItems[idx]) {
        target = tasks.find((row) => row.title === contextItems[idx]!.title);
      }
      if (!target) {
        return { handled: true, reply: `1〜${tasks.length} の番号を指定してください（例: 「タスク削除 1」）。` };
      }
      await db.query(`DELETE FROM near_tasks WHERE id = $1`, [target.id]);
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
      let target: TaskRow | undefined = tasks[idx];
      if (!target && contextItems[idx]) {
        target = tasks.find((row) => row.title === contextItems[idx]!.title);
      }
      if (!target) {
        return { handled: true, reply: `1〜${tasks.length} の番号を指定してください。` };
      }
      await db.query(
        `UPDATE near_tasks SET title = $1, updated_at = now() WHERE id = $2`,
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
