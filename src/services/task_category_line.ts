import type { Db } from "../db/client.js";
import {
  createTaskCategory,
  listTaskCategories,
  resolveCategoryByName,
} from "../db/task_categories_repo.js";
import type { TaskLineResult } from "./task_line.js";

const CREATE_RE =
  /(?:#|＃)?([^\s#、。]+?)(?:の)?カテゴリ(?:を)?(?:作って|作成|追加|登録)|カテゴリ(?:を)?(?:作って|作成|追加)[：:\s]*(?:#|＃)?([^\s、。]+)/u;
const LIST_RE = /(.+?)(?:の)?カテゴリ(?:一覧|リスト|見せて|教えて)|カテゴリ一覧/u;
const FILTER_LIST_RE = /(.+?)(?:の)?タスク(?:一覧|リスト|見せて|教えて|確認)/u;

export function looksLikeTaskCategoryCommand(text: string): boolean {
  const t = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  return CREATE_RE.test(t) || LIST_RE.test(t);
}

export async function tryHandleTaskCategoryLine(input: {
  db: Db;
  text: string;
  channelUserId: string;
  groupId?: string;
}): Promise<TaskLineResult> {
  const t = input.text.normalize("NFKC").replace(/\s+/g, " ").trim();

  const createMatch = t.match(CREATE_RE);
  if (createMatch) {
    const name = (createMatch[1] ?? createMatch[2] ?? "").trim();
    if (!name) {
      return { handled: true, reply: "カテゴリ名を教えてください。例: 「#仕事 カテゴリ作って」" };
    }
    try {
      const row = await createTaskCategory(input.db, {
        channelUserId: input.channelUserId,
        groupId: input.groupId,
        name,
      });
      return { handled: true, reply: `✅ カテゴリ「${row.name}」を作成しました。` };
    } catch {
      return { handled: true, reply: "カテゴリの作成中にエラーが発生しました。" };
    }
  }

  if (LIST_RE.test(t) && !FILTER_LIST_RE.test(t)) {
    try {
      const rows = await listTaskCategories(input.db, input.channelUserId, input.groupId);
      if (rows.length === 0) {
        return { handled: true, reply: "カテゴリはまだありません。「#仕事 カテゴリ作って」で追加できます。" };
      }
      const lines = rows.map((c, i) => `${i + 1}. ${c.name}`);
      return { handled: true, reply: `📂 カテゴリ一覧:\n\n${lines.join("\n")}` };
    } catch {
      return { handled: true, reply: "カテゴリ一覧の取得中にエラーが発生しました。" };
    }
  }

  return { handled: false, reply: "" };
}

export async function resolveCategoryIdForTaskAdd(
  db: Db,
  channelUserId: string,
  groupId: string | undefined,
  text: string
): Promise<{ categoryId: string | null; hint?: string }> {
  const t = text.normalize("NFKC");
  const withTask =
    t.match(/(.+?)を\s*([^\s、。]{1,24}?)(?:カテゴリ|カテゴリー)?(?:の)?タスク/u) ??
    t.match(/(.+?)を\s*([^\s、。]{1,24}?)(?:に|へ)(?:入れて|追加|登録)/u);
  const nameQuery = withTask?.[2]?.trim() ?? t.match(/#([^\s、。]+)/u)?.[1]?.trim();
  if (!nameQuery || nameQuery.length < 1) return { categoryId: null };

  const { category, ambiguous } = await resolveCategoryByName(db, channelUserId, groupId, nameQuery);
  if (category) return { categoryId: category.id };
  if (ambiguous.length > 0) {
    const names = ambiguous.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
    return {
      categoryId: null,
      hint: `カテゴリが複数見つかりました。番号で指定してください:\n${names}`,
    };
  }
  return { categoryId: null };
}
