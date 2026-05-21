/** LINE 表示名で呼びかける（グループ・名前呼び・メンション向け） */

export function normalizeLineCallerDisplayName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return "";
  return s.replace(/^@+/, "").slice(0, 40);
}

/** 例: 「太郎さん」 */
export function lineCallerSalutation(displayName: string | null | undefined): string {
  const n = normalizeLineCallerDisplayName(displayName ?? "");
  if (!n) return "";
  return `${n}さん`;
}

/** 返信先頭に「{LINE名}さん、」を付ける（既に含む場合はそのまま） */
export function prefixLineReplyWithCaller(
  reply: string,
  displayName: string | null | undefined
): string {
  const sal = lineCallerSalutation(displayName);
  if (!sal) return reply;
  const n = normalizeLineCallerDisplayName(displayName ?? "");
  if (reply.includes(sal) || (n && reply.includes(n))) return reply;
  return `${sal}、${reply.replace(/^\s+/, "")}`;
}
