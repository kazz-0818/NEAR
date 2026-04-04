import { getEnv } from "../config/env.js";
import { listCapabilityLines } from "../modules/capabilities.js";

/** 「何ができるようになったか」系 */
export function isWhatsNewCapabilityQuestion(text: string): boolean {
  const n = text.normalize("NFKC");
  const novelty =
    /(新しく|新たに|最近|こないだ|前より|増え|追加|アップデート|バージョンアップ|なった|強く|広が|拡張)/.test(n);
  return (
    (novelty && /(でき|対応|できること|機能|仕事|お願い)/.test(n)) ||
    /何ができるようになった/.test(n) ||
    (novelty && /できること.*(教え|一覧|まとめ)/.test(n)) ||
    /(changelog|チェンジログ|リリースノート)/i.test(n)
  );
}

export function buildWhatsNewDraft(): string {
  const env = getEnv();
  const lines = listCapabilityLines();
  const bullets = lines.map((l) => `・${l}`).join("\n");

  const parts: string[] = [
    "いま NEAR がお手伝いできることは、ざっくり次のとおりです。",
    "",
    bullets,
  ];

  if (env.NEAR_WHATS_NEW?.trim()) {
    parts.push("", "【最近・追加でできる／強くなったところ】", env.NEAR_WHATS_NEW.trim());
  }

  return parts.join("\n");
}
