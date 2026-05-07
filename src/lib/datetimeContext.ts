const TZ = "Asia/Tokyo";

/** JST の「いま」を ISO8601 風に（+09:00 固定。日本は夏時間なし） */
export function formatJstNowIsoForPrompt(from: Date = new Date()): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = f.formatToParts(from);
  const g = (type: Intl.DateTimeFormatPart["type"]) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}+09:00`;
}

export type IntentUserEnvelopeContext = {
  recentUserMessages?: string[];
  recentAssistantMessages?: string[];
};

/** 意図分類 API に渡すユーザー欄（先頭に現在時刻 + 会話履歴コンテキスト） */
export function buildIntentUserEnvelope(
  userText: string,
  from: Date = new Date(),
  context: IntentUserEnvelopeContext = {}
): string {
  const iso = formatJstNowIsoForPrompt(from);
  const weekday = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    weekday: "long",
  }).format(from);

  const header = `[参照: 現在は日本時間(JST) ${iso}（${weekday}）です。相対指定（○分後・○時間後など）はこの時刻を起点にし、reminder_request の datetime_iso にはその絶対時刻の ISO8601（タイムゾーン付き）を入れてください。]`;

  const prevUser = (context.recentUserMessages ?? []).filter((s) => s.trim()).slice(-6);
  const prevAsst = (context.recentAssistantMessages ?? []).filter((s) => s.trim()).slice(-4);

  const contextBlocks: string[] = [];
  if (prevUser.length > 0) {
    const lines = prevUser.map((s, i) => `${i + 1}. ${s.length > 300 ? s.slice(0, 300) + "…" : s}`).join("\n");
    contextBlocks.push(`[直近の会話（ユーザー側・古い順）:\n${lines}\n]`);
  }
  if (prevAsst.length > 0) {
    const lines = prevAsst.map((s, i) => `${i + 1}. ${s.length > 400 ? s.slice(0, 400) + "…" : s}`).join("\n");
    contextBlocks.push(`[直近の会話（NEAR 側・古い順）:\n${lines}\n]`);
  }

  const parts = [header];
  if (contextBlocks.length > 0) {
    parts.push(...contextBlocks);
    parts.push("[上記の会話の流れを踏まえて、今回の発言の意図を分類してください。続き・省略・代名詞は前の文脈から補完する。]");
  }
  parts.push(`---\n\n${userText}`);

  return parts.join("\n\n");
}

/**
 * 「N分後」など相対指定だけサーバーで確定（LLM の捏造日付より優先）。
 */
export function parseRelativeReminderAt(text: string, from: Date = new Date()): Date | null {
  const n = text.normalize("NFKC");
  const base = from.getTime();

  const candidates: Array<{ re: RegExp; mult: number; max: number }> = [
    { re: /(\d+)\s*分後/u, mult: 60_000, max: 10_080 },
    { re: /あと\s*(\d+)\s*分/u, mult: 60_000, max: 10_080 },
    { re: /(\d+)\s*時間後/u, mult: 3_600_000, max: 720 },
    { re: /あと\s*(\d+)\s*時間/u, mult: 3_600_000, max: 720 },
    { re: /(\d+)\s*秒後/u, mult: 1_000, max: 86_400 },
  ];

  for (const { re, mult, max } of candidates) {
    const m = n.match(re);
    if (!m) continue;
    const num = Number.parseInt(m[1], 10);
    if (!Number.isFinite(num) || num < 0 || num > max) continue;
    return new Date(base + num * mult);
  }
  return null;
}

/** LLM が過去日を捏造したときはリマインドとして採用しない（秒単位の誤差は許容） */
export function isReminderTimeInPast(iso: Date, now: Date = new Date(), graceMs = 120_000): boolean {
  return iso.getTime() < now.getTime() - graceMs;
}
