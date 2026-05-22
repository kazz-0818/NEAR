/** 「何ができますか？」系 — 専門用語なしの箇条書き（LINE 向け） */

export const NEAR_CAPABILITY_BULLETS = [
  "やること・タスクの登録と確認",
  "おぼえておいてほしいことのメモ",
  "日時がわかるリマインダー（いつ頃か教えてもらえると助かります）",
  "短い文章の要約や整理",
  "雑談や相談（仕事・学習・考えごとなど）",
  "共有してもらった表の数字の読み取りや整理（Googleの表）",
  "カレンダーの予定の確認・追加（あらかじめ連携したあと）",
  "マーケ・経理・記事・監査など、ほかの担当への取り次ぎ",
] as const;

/** いろんな言い回しを拾う（NFKC 後に判定） */
export const CAPABILITIES_HELP_RE =
  /何ができ|なにができ|できること|何ができます|何をしてくれ|何を手伝|何が使え|何が頼め|何を頼め|使い方|ヘルプ|help|機能一覧|機能は何|機能教えて|できる[?？]|できますか|お願いできる|仕事は何|役割は|できること教えて|教えて.*できる/iu;

export function normalizeHelpQuery(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, "");
}

export function isCapabilitiesHelpQuestion(text: string): boolean {
  const n = normalizeHelpQuery(text);
  if (!n || n.length > 80) return false;
  return CAPABILITIES_HELP_RE.test(n);
}

export function buildNearCapabilitiesHelpReply(): string {
  return [
    "NEAR（秘書）で、いまお手伝いできることはだいたい次のとおりです。",
    "",
    ...NEAR_CAPABILITY_BULLETS.map((l) => `・${l}`),
    "",
    "上記以外も、できる範囲で対応します。まだ無理なことは記録して、あとでできるようにしていきます。",
  ].join("\n");
}
