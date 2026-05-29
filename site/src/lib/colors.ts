/** メンバー公式カラー（ショーケース・UI 共通） */
export const AGENT_ACCENTS: Record<string, string> = {
  near: "#f472b6", // ピンク
  sera: "#facc15", // 黄
  irie: "#c4b5fd", // うす紫
  rits: "#22c55e", // 緑
  lram: "#f97316", // オレンジ
  core: "#e2e8f0", // 中央ハブ（CORE）
};

/** ヒーロー軌道の中央 CORE */
export const CORE_ACCENT = AGENT_ACCENTS.core;

export const RING_ORDER = ["near", "sera", "lram", "irie", "rits"] as const;
