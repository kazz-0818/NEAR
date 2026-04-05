/** スプレッドシート A1 記法用にシート名をエスケープ */
export function escapeSheetTitleForA1(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function valuesToTsv(rows: unknown[][] | null | undefined): string {
  if (!rows || rows.length === 0) return "(データなし)";
  return rows
    .map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))).join("\t") : ""))
    .join("\n");
}

export function clipTsv(s: string, max = 28000): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 40) + "\n…(以降省略。必要なら範囲を指定してください)";
}

export function resolveSheetTitle(pick: string, titles: string[]): string {
  const t = pick.trim();
  if (titles.includes(t)) return t;
  const lower = t.toLowerCase();
  const partial = titles.find(
    (x) =>
      x.toLowerCase().includes(lower) ||
      lower.includes(x.toLowerCase()) ||
      x.replace(/\s/g, "").toLowerCase().includes(lower.replace(/\s/g, ""))
  );
  if (partial) return partial;
  return titles[0] ?? t;
}
