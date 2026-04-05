/** 成長難易度。SSS が最難。DB の implementation_suggestions.difficulty に格納する。 */
export const GROWTH_DIFFICULTY_TIERS = ["E", "D", "C", "B", "A", "S", "SS", "SSS"] as const;
export type GrowthDifficultyTier = (typeof GROWTH_DIFFICULTY_TIERS)[number];

const TIER_SET = new Set<string>(GROWTH_DIFFICULTY_TIERS);

export function isGrowthDifficultyTier(s: string): s is GrowthDifficultyTier {
  return TIER_SET.has(s);
}

/** 通知・UI 用の短い日本語ラベル */
export const GROWTH_TIER_SHORT_LABEL: Record<GrowthDifficultyTier, string> = {
  E: "最小（設定・文言中心で済む想定）",
  D: "小さめ",
  C: "標準",
  B: "やや大きい",
  A: "大きめ",
  S: "重い",
  SS: "非常に重い",
  SSS: "最難（別プロダクト級・長期研究が必要になり得る）",
};

export function formatGrowthDifficultyLines(tier: string | null | undefined): string[] {
  if (!tier || !isGrowthDifficultyTier(tier)) return [];
  return [`【成長難易度】${tier}（${GROWTH_TIER_SHORT_LABEL[tier]}）`, ""];
}
