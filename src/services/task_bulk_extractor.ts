import OpenAI from "openai";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger();

const bulkItemSchema = z.object({
  title: z.string().min(1),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const bulkSchema = z.object({
  items: z.array(bulkItemSchema).min(1).max(30),
});

export type BulkTaskItem = z.infer<typeof bulkItemSchema>;

const BULK_INTRO_RE =
  /(?:を|、)?(?:タスク|todo|やること)(?:リスト)?(?:に)?(?:追加|入れて|登録|まとめて|一括)|タスクに(?:して|入れて)/u;

export function looksLikeBulkTaskAdd(text: string): boolean {
  const t = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!BULK_INTRO_RE.test(t)) return false;
  const ruleItems = splitBulkTitlesByRules(t);
  return ruleItems.length >= 2;
}

export function splitBulkTitlesByRules(text: string): string[] {
  const t = text.normalize("NFKC").trim();
  let body = t
    .replace(
      /\s*(?:を|、)?(?:タスク|todo|やること)(?:リスト)?(?:に)?(?:追加|入れて|登録|まとめて|一括|して)?\s*$/iu,
      ""
    )
    .trim();
  if (!body) {
    body = t.replace(/^(?:タスク|todo|やること)(?:に)?(?:追加|入れて|登録)[：:\s]*/iu, "").trim();
  }

  const segments: string[] = [];
  const push = (s: string) => {
    const x = s.replace(/^[・\-\*●○◯▪▫\d]+[\.．、)\]】\s]*/u, "").trim();
    if (x.length >= 1 && x.length <= 500) segments.push(x);
  };

  if (body.includes("\n")) {
    for (const line of body.split(/\r?\n/)) push(line);
    if (segments.length >= 2) return dedupeTitles(segments);
  }

  if (/[、,，]/.test(body) && !/(タスク|todo)/iu.test(body.split(/[、,，]/)[0] ?? "")) {
    for (const part of body.split(/[、,，]/)) push(part);
    if (segments.length >= 2) return dedupeTitles(segments);
  }

  const bulletParts = body.split(/(?=[・●○◯▪\d]+[\.．、])/u).filter(Boolean);
  if (bulletParts.length >= 2) {
    for (const p of bulletParts) push(p);
    if (segments.length >= 2) return dedupeTitles(segments);
  }

  return dedupeTitles(segments);
}

function dedupeTitles(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.normalize("NFKC");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function extractBulkTaskItems(
  text: string,
  deps?: { callModel?: (userContent: string) => Promise<string> }
): Promise<BulkTaskItem[]> {
  const ruleTitles = splitBulkTitlesByRules(text);
  const env = getEnv();

  if (ruleTitles.length >= 2) {
    return ruleTitles.map((title) => ({ title }));
  }

  if (!env.NEAR_TASK_BULK_EXTRACT_ENABLED) {
    return [];
  }

  const userContent =
    `ユーザーの発言から、追加するタスクを JSON で返してください。\n` +
    `形式: {"items":[{"title":"...","category":null,"notes":null}]}\n` +
    `タイトルは短く。カテゴリ名があれば category に文字列、なければ null。\n\n` +
    `発言:\n${text.trim()}`;

  try {
    const raw = deps?.callModel
      ? await deps.callModel(userContent)
      : await (async () => {
          const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
          const completion = await client.chat.completions.create({
            model: env.OPENAI_INTENT_MODEL,
            messages: [
              {
                role: "system",
                content: "You extract task items from Japanese user messages. Reply with JSON only.",
              },
              { role: "user", content: userContent },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 800,
          });
          return completion.choices[0]?.message?.content ?? "";
        })();

    const parsed = bulkSchema.parse(JSON.parse(raw));
    return parsed.items.map((it) => ({
      title: it.title.trim(),
      category: it.category?.trim() || null,
      notes: it.notes?.trim() || null,
    }));
  } catch (e) {
    log.warn({ err: e }, "bulk task LLM extract failed, falling back to rules");
    if (ruleTitles.length >= 2) {
      return ruleTitles.map((title) => ({ title }));
    }
    return [];
  }
}
