import type { UserMemoryFact, UserMemoryPromptContext } from "../models/userMemory.js";

const CATEGORY_LABEL: Record<UserMemoryFact["category"], string> = {
  preference: "好み",
  role: "役割",
  workflow: "よく使う手順",
  constraint: "注意",
  relationship: "関係",
  other: "その他",
};

/** LLM へ渡す前の軽いマスク（完全な PII 対策ではない） */
export function redactSensitiveForMemory(text: string): string {
  let out = text;
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  out = out.replace(/\b0\d{9,10}\b/g, "[REDACTED_PHONE]");
  out = out.replace(/\b\d{10,}\b/g, "[REDACTED_NUM]");
  return out;
}

export function buildUserMemoryPromptBlock(ctx: UserMemoryPromptContext | null): string {
  if (!ctx) return "";
  const hasBody =
    !!ctx.memorySummary.trim() ||
    ctx.memoryFacts.some((f) => f.fact.trim()) ||
    !!ctx.adminMemo?.trim() ||
    !!ctx.callPreference?.trim();
  if (!hasBody) return "";

  const parts: string[] = [];

  parts.push("【このユーザーについての長期記憶（過去の会話から蓄積・事実ベース）】");
  if (ctx.displayName?.trim()) {
    parts.push(`LINE表示名: ${ctx.displayName.trim()}`);
  }
  if (ctx.callPreference?.trim()) {
    parts.push(`呼び方の好み: ${ctx.callPreference.trim()}`);
  }
  if (ctx.adminMemo?.trim()) {
    parts.push(`管理者メモ（手動・優先）: ${ctx.adminMemo.trim().slice(0, 800)}`);
  }
  if (ctx.memorySummary.trim()) {
    parts.push(`要約: ${ctx.memorySummary.trim().slice(0, 2000)}`);
  }
  const facts = ctx.memoryFacts
    .filter((f) => f.fact.trim())
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 20);
  if (facts.length) {
    parts.push(
      "覚えていること:",
      ...facts.map((f) => `- [${CATEGORY_LABEL[f.category]}] ${f.fact.trim()}`)
    );
  }
  parts.push(
    "※ 記憶と矛盾する発言があったら、今回の発言を優先しつつ自然に確認する。記憶をユーザーに丸出しにしない。"
  );
  return parts.join("\n");
}

export function mergeMemoryFacts(
  existing: UserMemoryFact[],
  incoming: UserMemoryFact[],
  maxFacts: number
): UserMemoryFact[] {
  const byKey = new Map<string, UserMemoryFact>();
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  for (const f of [...existing, ...incoming]) {
    const key = norm(f.fact);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || (f.confidence ?? 0) >= (prev.confidence ?? 0)) {
      byKey.set(key, {
        ...f,
        fact: f.fact.trim().slice(0, 400),
        learned_at: f.learned_at ?? new Date().toISOString(),
      });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, maxFacts);
}
