import type { Db } from "../db/client.js";
import { createTaskCategory, resolveCategoryByName } from "../db/task_categories_repo.js";
import { parseReminderAtFromDescription } from "../lib/datetimeContext.js";
import { getLogger } from "../lib/logger.js";
import {
  looksLikeReminderRequest,
  parseReminderWhenDescription,
} from "../lib/taskListContext.js";
import type { TaskLineResult } from "./task_line.js";

const log = getLogger();

const COMPOUND_RE =
  /^(.+?)\s*(?:を\s*)?タスク(?:リスト)?(?:に)?(?:追加|入れて|登録|入れ).+?((?:あと\s*)?\d+\s*(?:秒|分|時間)後|明日\s*の?\s*\d{1,2}\s*時(?:\s*\d{1,2}\s*分|半)?|今日\s*の?\s*\d{1,2}\s*時(?:\s*\d{1,2}\s*分|半)?|明日|今日).*(?:リマインド|通知して|教えて|思い出させ)/u;

export function looksLikeCompoundTaskAddWithReminder(text: string): boolean {
  const t = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!looksLikeReminderRequest(t)) return false;
  if (!/タスク(?:リスト)?(?:に)?(?:追加|入れて|登録|入れ)/u.test(t)) return false;
  return parseReminderWhenDescription(t) != null;
}

export function extractCompoundParts(text: string): { title: string; whenDescription: string } | null {
  const t = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  const whenDescription = parseReminderWhenDescription(t);
  if (!whenDescription) return null;

  const m = t.match(COMPOUND_RE);
  if (m?.[1]) {
    const title = m[1].trim();
    if (title.length >= 1) return { title, whenDescription };
  }

  const addIdx = t.search(/タスク(?:リスト)?(?:に)?(?:追加|入れて|登録|入れ)/u);
  if (addIdx <= 0) return null;
  const title = t.slice(0, addIdx).replace(/(?:を|は)\s*$/u, "").trim();
  if (!title || title.length < 1) return null;
  return { title, whenDescription };
}

export async function saveTaskWithReminderInDb(input: {
  db: Db;
  channelUserId: string;
  actorUserId: string;
  groupId?: string;
  title: string;
  whenDescription: string;
  categoryName?: string | null;
}): Promise<{ ok: true; reply: string } | { ok: false; reply: string }> {
  const remindAt = parseReminderAtFromDescription(input.whenDescription);
  if (!remindAt) {
    return {
      ok: false,
      reply: "リマインドの日時が読み取れませんでした。「明日17時」「30分後」のように指定してください。",
    };
  }

  let categoryId: string | null = null;
  if (input.categoryName?.trim()) {
    const { category } = await resolveCategoryByName(
      input.db,
      input.channelUserId,
      input.groupId,
      input.categoryName.trim()
    );
    if (category) categoryId = category.id;
    else {
      const created = await createTaskCategory(input.db, {
        channelUserId: input.channelUserId,
        groupId: input.groupId,
        name: input.categoryName.trim(),
      });
      categoryId = created.id;
    }
  }

  const taskScope = input.groupId ? "group" : "personal";
  const whenLabel = remindAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  try {
    await input.db.query("BEGIN");
    const ins = await input.db.query<{ id: string }>(
      `INSERT INTO near_tasks (channel, channel_user_id, actor_user_id, group_id, task_scope, title, notes, category_id, status, created_at, updated_at)
       VALUES ('line', $1, $2, $3, $4, $5, NULL, $6::uuid, 'open', now(), now())
       RETURNING id::text`,
      [
        input.channelUserId,
        input.actorUserId,
        input.groupId ?? null,
        taskScope,
        input.title.trim(),
        categoryId,
      ]
    );
    const taskId = ins.rows[0]?.id;
    if (!taskId) throw new Error("task_insert_failed");

    await input.db.query(
      `INSERT INTO near_reminders (channel, channel_user_id, actor_user_id, group_id, remind_at, message, status, task_id)
       VALUES ('line', $1, $2, $3, $4, $5, 'pending', $6::bigint)`,
      [
        input.channelUserId,
        input.actorUserId,
        input.groupId ?? null,
        remindAt.toISOString(),
        input.title.trim(),
        taskId,
      ]
    );
    await input.db.query("COMMIT");
    return {
      ok: true,
      reply: `「${input.title.trim()}」をタスクに追加し、${whenLabel} にリマインドを設定しました。`,
    };
  } catch (e) {
    await input.db.query("ROLLBACK").catch(() => {});
    log.error({ err: e }, "saveTaskWithReminderInDb failed");
    return { ok: false, reply: "タスクとリマインドの登録中にエラーが発生しました。" };
  }
}

export async function tryHandleTaskCompoundLine(input: {
  db: Db;
  text: string;
  channelUserId: string;
  actorUserId: string;
  groupId?: string;
}): Promise<TaskLineResult> {
  if (!looksLikeCompoundTaskAddWithReminder(input.text)) {
    return { handled: false, reply: "" };
  }

  const parts = extractCompoundParts(input.text);
  if (!parts) {
    return { handled: false, reply: "" };
  }

  const saved = await saveTaskWithReminderInDb({
    db: input.db,
    channelUserId: input.channelUserId,
    actorUserId: input.actorUserId,
    groupId: input.groupId,
    title: parts.title,
    whenDescription: parts.whenDescription,
  });
  if (!saved.ok) {
    return { handled: true, reply: saved.reply };
  }
  log.info({ title: parts.title }, "compound task+reminder added");
  return {
    handled: true,
    reply: `✅ ${saved.reply}`,
    sessionMemoryWrite: {
      memoryType: "latest_task_created",
      value: { title: parts.title },
      ttlMinutes: 120,
    },
  };
}
