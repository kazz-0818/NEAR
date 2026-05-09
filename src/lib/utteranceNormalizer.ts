export type NormalizedUtterance = {
  raw: string;
  normalized: string;
  lines: string[];
  compact: string;
};

function canonicalizeTerms(input: string): string {
  return input
    .replace(/タスク\s*リスト/giu, "タスクリスト")
    .replace(/to\s*do/giu, "todo")
    .replace(/ＴＯＤＯ/gu, "todo")
    .replace(/やる\s*こと/giu, "やること")
    .replace(/google\s*sheet(?:s)?/giu, "googleシート")
    .replace(/スプレット/gu, "スプレッド")
    .replace(/スプシ/gu, "スプシ")
    .replace(/スプレッド\s*シート/gu, "スプレッドシート");
}

export function normalizeUserUtterance(text: string): NormalizedUtterance {
  const raw = text ?? "";
  const normalized = canonicalizeTerms(
    raw
      .normalize("NFKC")
      .replace(/\u3000/g, " ")
      .replace(/\r\n/g, "\n")
      .trim()
  );
  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const compact = normalized.replace(/\s+/g, " ").trim();
  return { raw, normalized, lines, compact };
}
