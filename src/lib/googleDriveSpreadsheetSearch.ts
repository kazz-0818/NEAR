import type { drive_v3 } from "googleapis";

export type DriveSpreadsheetHit = { id: string; name: string };

const STOPWORDS = new Set([
  "ください",
  "お願い",
  "します",
  "して",
  "したい",
  "できる",
  "です",
  "ます",
  "読んで",
  "読み",
  "見て",
  "教えて",
  "出して",
  "ざっくり",
  "部分",
  "これ",
  "それ",
  "あれ",
  "この",
  "その",
  "どの",
  "何",
  "なに",
  "やつ",
  "もの",
  "的",
  "を",
  "に",
  "は",
  "が",
  "も",
  "と",
  "や",
  "へ",
  "で",
  "の",
]);

function escapeDriveQueryLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * ユーザーの自然文から Drive の name contains 用キーワードを抽出する（長い語を優先）。
 */
export function extractSpreadsheetSearchTerms(text: string): string[] {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const out: string[] = [];

  for (const m of normalized.matchAll(/【([^】]{2,80})】/g)) {
    const inner = m[1].trim();
    if (inner.length >= 2) out.push(inner);
  }

  const segments = normalized.split(/[\s　、。,.]+/).filter(Boolean);
  for (const seg of segments) {
    const sub = seg
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .replace(/(の|って|ってる|ってます)$/u, "");
    if (sub.length >= 2 && !STOPWORDS.has(sub)) out.push(sub);
  }

  const words = normalized.match(/[\u30a0-\u30ff\u3040-\u309f\u4e00-\u9fff]{2,24}/g) ?? [];
  for (const w of words) {
    const w2 = w.replace(/(の|って)$/u, "");
    if (w2.length >= 2 && !STOPWORDS.has(w2)) out.push(w2);
  }

  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const t of out) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(t);
  }

  return uniq.sort((a, b) => b.length - a.length);
}

/** 比較用に記号・空白を除いた文字列 */
function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s　【】\[\]｜|・./／\\\-_:：、。,!！?？]+/g, "")
    .toLowerCase();
}

function bigramJaccard(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const ba = new Set<string>();
  const bb = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) ba.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bb.add(b.slice(i, i + 2));
  let inter = 0;
  for (const x of ba) if (bb.has(x)) inter++;
  const union = ba.size + bb.size - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * ざっくりした言い方でも寄せられるよう、語の分割・短い断片を足して Drive OR 検索の幅を広げる。
 */
export function expandTermsForRoughSheetName(terms: string[], rawUser: string): string[] {
  const out: string[] = [...terms];
  for (const t of terms) {
    for (const part of t.split(/[・／/|｜\s　]+/u).map((s) => s.trim())) {
      const p = part.replace(/(の|って)$/u, "");
      if (p.length >= 2 && !STOPWORDS.has(p)) out.push(p);
    }
  }
  const hint = rawUser.normalize("NFKC").replace(/https?:\/\/\S+/gi, "");
  for (const m of hint.matchAll(/【([^】]{2,40})】/g)) {
    const inner = m[1].trim();
    if (inner.length >= 2) out.push(inner);
    for (const part of inner.split(/[・／/|｜\s　]+/u)) {
      const p = part.trim();
      if (p.length >= 2 && !STOPWORDS.has(p)) out.push(p);
    }
  }
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const t of out) {
    const k = t.toLowerCase();
    if (seen.has(k) || t.length < 2) continue;
    seen.add(k);
    uniq.push(t);
  }
  return uniq.sort((a, b) => b.length - a.length);
}

type ScoredHit = DriveSpreadsheetHit & { score: number };

function scoreSpreadsheetNameMatch(fileName: string, terms: string[], rawUser: string): number {
  const nFile = normalizeForMatch(fileName);
  const rawN = normalizeForMatch(rawUser.replace(/https?:\/\/\S+/gi, ""));
  let s = 0;
  const dedupTerms = [...new Set(terms.map((t) => normalizeForMatch(t)).filter((t) => t.length >= 2))];
  for (const nt of dedupTerms) {
    if (nFile.includes(nt)) {
      s += 12 + Math.min(nt.length, 14) * 0.4;
      continue;
    }
    let bestPart = 0;
    for (let len = Math.min(nt.length, 8); len >= 2; len--) {
      for (let i = 0; i + len <= nt.length; i++) {
        const sub = nt.slice(i, i + len);
        if (nFile.includes(sub)) bestPart = Math.max(bestPart, len);
      }
    }
    if (bestPart > 0) s += bestPart * 1.8;
  }
  s += bigramJaccard(rawN, nFile) * 10;
  return s;
}

async function listSpreadsheetFiles(drive: drive_v3.Drive, q: string, pageSize: number): Promise<DriveSpreadsheetHit[]> {
  const res = await drive.files.list({
    q,
    pageSize,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = res.data.files ?? [];
  return files
    .filter(
      (f): f is { id: string; name: string } =>
        typeof f.id === "string" && f.id.length > 0 && typeof f.name === "string" && f.name.length > 0
    )
    .map((f) => ({ id: f.id, name: f.name }));
}

function dedupeHits(hits: DriveSpreadsheetHit[]): DriveSpreadsheetHit[] {
  const byId = new Map<string, DriveSpreadsheetHit>();
  for (const h of hits) {
    if (!byId.has(h.id)) byId.set(h.id, h);
  }
  return [...byId.values()];
}

export type DriveSpreadsheetSearchOutcome =
  | { kind: "one"; id: string; name: string }
  | { kind: "confirm"; suggested: DriveSpreadsheetHit; alternatives: DriveSpreadsheetHit[] }
  | { kind: "none" }
  | { kind: "insufficient_scope" };

function isInsufficientScopeError(err: unknown): boolean {
  const msg = err && typeof err === "object" && "message" in err ? String((err as Error).message) : String(err);
  const code =
    err && typeof err === "object" && "code" in err ? Number((err as { code?: unknown }).code) : NaN;
  return code === 403 || /Insufficient Permission|insufficient authentication scopes/i.test(msg);
}

function decideOutcome(ranked: ScoredHit[]): DriveSpreadsheetSearchOutcome {
  if (ranked.length === 0) return { kind: "none" };
  const top = ranked[0];
  if (ranked.length === 1) return { kind: "one", id: top.id, name: top.name };
  const second = ranked[1];
  const gap = top.score - second.score;
  const strong = top.score >= 18 && gap >= 2;
  const veryClear = gap >= 5;
  const loneHigh = top.score >= 22 && gap >= 3;
  if (veryClear || loneHigh || strong) {
    return { kind: "one", id: top.id, name: top.name };
  }
  const alts = ranked.slice(1, 6).map(({ id, name }) => ({ id, name }));
  return {
    kind: "confirm",
    suggested: { id: top.id, name: top.name },
    alternatives: alts,
  };
}

/**
 * ユーザーの発言から Drive 上のスプレッドシートを名前検索する。
 * ざっくりしたキーワードでも寄せるため広めに拾い、スコアで順位付けする。
 */
export async function searchSpreadsheetByUserHint(
  drive: drive_v3.Drive,
  userMessage: string
): Promise<DriveSpreadsheetSearchOutcome> {
  const raw = userMessage.trim();
  const baseTerms = extractSpreadsheetSearchTerms(raw);
  const terms = expandTermsForRoughSheetName(baseTerms, raw);
  if (terms.length === 0) return { kind: "none" };

  const base = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";

  const orClause = (slice: string[]) => {
    const parts = slice.map((t) => `name contains '${escapeDriveQueryLiteral(t)}'`);
    return `${base} and (${parts.join(" or ")})`;
  };

  const andClause = (slice: string[]) => {
    const parts = slice.map((t) => `name contains '${escapeDriveQueryLiteral(t)}'`);
    return `${base} and ${parts.join(" and ")}`;
  };

  try {
    const collected: DriveSpreadsheetHit[] = [];
    const topForOr = terms.slice(0, 8);
    collected.push(...(await listSpreadsheetFiles(drive, orClause(topForOr), 50)));

    if (collected.length < 3 && terms.length > 0) {
      for (const t of terms.slice(0, 5)) {
        collected.push(...(await listSpreadsheetFiles(drive, `${base} and name contains '${escapeDriveQueryLiteral(t)}'`, 25)));
      }
    }

    if (terms.length >= 2) {
      const tight = terms.slice(0, Math.min(3, terms.length));
      const tightHits = await listSpreadsheetFiles(drive, andClause(tight), 30);
      collected.push(...tightHits);
    }

    const unique = dedupeHits(collected);
    if (unique.length === 0) return { kind: "none" };

    const scored: ScoredHit[] = unique
      .map((h) => ({
        ...h,
        score: scoreSpreadsheetNameMatch(h.name, terms, raw),
      }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { kind: "none" };

    return decideOutcome(scored);
  } catch (e) {
    if (isInsufficientScopeError(e)) return { kind: "insufficient_scope" };
    throw e;
  }
}
