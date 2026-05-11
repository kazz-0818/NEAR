export type TaskListItem = {
  number: number;
  title: string;
  scope?: string | null;
};

function parseTaskListFromMessage(message: string): TaskListItem[] {
  const normalized = message.normalize("NFKC");
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: TaskListItem[] = [];
  for (const line of lines) {
    if (/^(完了|削除)\s*:/u.test(line)) continue;
    const m = line.match(/^([1-9][0-9]*)\.\s*(?:【([^】]+)】\s*)?(.+)$/u);
    if (!m) continue;
    const number = Number.parseInt(m[1], 10);
    if (!Number.isFinite(number) || number <= 0) continue;
    const scope = m[2]?.trim() || null;
    const title = (m[3] ?? "").trim();
    if (!title) continue;
    items.push({ number, title, scope });
  }
  return items;
}

export function extractTaskItemsFromAssistantMessages(messages: string[]): TaskListItem[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = (messages[i] ?? "").trim();
    if (!text) continue;
    const items = parseTaskListFromMessage(text);
    if (items.length > 0) return items;
  }
  return [];
}

export function parseTaskTargetNumber(text: string): number | null {
  const t = text.normalize("NFKC").trim();
  if (!t) return null;
  const digit = t.match(/([1-9][0-9]*)\s*(?:番|ばん|つ目|個目)?/u);
  if (digit?.[1]) return Number.parseInt(digit[1], 10);
  if (/(一番|いちばん|一つ目|ひとつめ|最初|上のやつ)/u.test(t)) return 1;
  if (/(二番|にばん|二つ目|ふたつめ)/u.test(t)) return 2;
  if (/(三番|さんばん|三つ目|みっつめ)/u.test(t)) return 3;
  return null;
}

export function parseReminderWhenDescription(text: string): string | null {
  const t = text.normalize("NFKC");
  const m = t.match(
    /((?:あと\s*)?\d+\s*(?:秒|分|時間)後|明日\s*の?\s*\d{1,2}時(?:\d{1,2}分)?|今日\s*の?\s*\d{1,2}時(?:\d{1,2}分)?|明日|今日)/u
  );
  return m?.[1]?.trim() ?? null;
}

export function looksLikeReminderRequest(text: string): boolean {
  const t = text.normalize("NFKC");
  return /(リマインド|教えて|通知|思い出させ)/u.test(t);
}
