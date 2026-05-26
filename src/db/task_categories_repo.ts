import type { Db } from "./client.js";

export type TaskCategoryRow = {
  id: string;
  name: string;
  slug: string;
};

export function slugifyCategoryName(name: string): string {
  const n = name.normalize("NFKC").trim().toLowerCase();
  const ascii = n
    .replace(/[#＃]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff-]/gu, "")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (ascii.length >= 1) return ascii.slice(0, 64);
  return `cat-${Date.now().toString(36)}`;
}

export async function listTaskCategories(
  db: Db,
  channelUserId: string,
  groupId?: string
): Promise<TaskCategoryRow[]> {
  const res = await db.query<TaskCategoryRow>(
    `SELECT id::text, name, slug
     FROM near_task_categories
     WHERE channel_user_id = $1
       AND (($2::text IS NULL AND group_id IS NULL) OR group_id = $2)
     ORDER BY name ASC`,
    [channelUserId, groupId ?? null]
  );
  return res.rows;
}

export async function createTaskCategory(
  db: Db,
  input: { channelUserId: string; groupId?: string; name: string }
): Promise<TaskCategoryRow> {
  const slug = slugifyCategoryName(input.name);
  const existing = await resolveCategoryByName(db, input.channelUserId, input.groupId, input.name);
  if (existing.category) return existing.category;

  const ins = await db.query<TaskCategoryRow>(
    `INSERT INTO near_task_categories (channel, channel_user_id, group_id, name, slug)
     VALUES ('line', $1, $2, $3, $4)
     RETURNING id::text, name, slug`,
    [input.channelUserId, input.groupId ?? null, input.name.trim(), slug]
  );
  return ins.rows[0]!;
}

export async function resolveCategoryByName(
  db: Db,
  channelUserId: string,
  groupId: string | undefined,
  nameQuery: string
): Promise<{ category: TaskCategoryRow | null; ambiguous: TaskCategoryRow[] }> {
  const q = nameQuery.normalize("NFKC").trim().replace(/^#/, "");
  if (!q) return { category: null, ambiguous: [] };

  const all = await listTaskCategories(db, channelUserId, groupId);
  const exact = all.filter((c) => c.name === q || c.slug === slugifyCategoryName(q));
  if (exact.length === 1) return { category: exact[0]!, ambiguous: [] };
  if (exact.length > 1) return { category: null, ambiguous: exact };

  const partial = all.filter((c) => c.name.includes(q) || c.slug.includes(slugifyCategoryName(q)));
  if (partial.length === 1) return { category: partial[0]!, ambiguous: [] };
  if (partial.length > 1) return { category: null, ambiguous: partial };
  return { category: null, ambiguous: [] };
}
