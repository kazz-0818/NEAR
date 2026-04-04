import type { Db } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { listCapabilityLines } from "../modules/capabilities.js";

/**
 * 「いま何ができるか／最近の増分／スキルや範囲の説明」を幅広く拾う。
 * 1:1 の LINE 前提で、秘書・NEAR への能力問いかけとみなせる文を多めに通す。
 */
export function isWhatsNewCapabilityQuestion(text: string): boolean {
  const n = text.normalize("NFKC");

  if (/(changelog|チェンジログ|リリースノート|what\s*'?s\s*new|whats\s*new)/i.test(n)) {
    return true;
  }

  // 「〜できるようになった」系（口語・丁寧のゆらぎ）
  if (
    /何ができるように(なった|なりました|なる|なります)/.test(n) ||
    /でき(る)?ようにな(った|って|っ|りました|ります|る)/.test(n) ||
    /(できる|対応)ように(なった|なりました)/.test(n) ||
    (/(強く|賢く)な(った|りました|る)/.test(n) &&
      /(near|ニア|あなた|君|きみ|秘書|ボット)/i.test(n))
  ) {
    return true;
  }

  const agent =
    /(near|ニア|あなた|君|きみ|ボット|秘書|そちら|そっち|この子|うちの子|その子)/i.test(n);

  const ability =
    /(できる|できない|できん|対応|お手伝い|手伝い|助け|サポート|頼める|任せ|仕事|業務|機能|スキル|範囲|限界|得意|不得意|役割)/.test(
      n
    );

  const wh =
    /(何が|なにが|どんなこと|どんなの|どういう(こと|の)?|いくつ|どこまで|一覧|ぜんぶ|全部|リスト|まとめ|概要|ざっくり)/.test(
      n
    );

  const tell =
    /(教えて|教えてく|聞かせ|把握して|知ってる|知ってい|説明して|詳しく|おしえて)/.test(n);

  const timeOrDelta =
    /(今|いま|現在|最新|最近|こないだ|さっき|この頃|前より|新|増|追加|変わ|変え|アップデート|バージョン|アプデ|upgrade|反映|更新|デプロイ|進化|成長|レベル|強化)/.test(
      n
    );

  // エージェントに言及 +「何ができる／範囲は」系
  if (agent && wh && ability) return true;

  // エージェント + 説明して + 能力関連語
  if (agent && tell && ability) return true;

  // 「最近〜機能」「いまの対応」など時間・変化 + 能力語（主語なしでも 1:1 なら NEAR 向けとみなす）
  if (timeOrDelta && ability && (wh || tell || /(増えた|減った|変わった|新しい|追加された)/.test(n))) {
    return true;
  }

  // 「できること全部」「対応範囲は」など短い能力一覧の依頼
  if (
    (ability && /(一覧|全部|ぜんぶ|まとめて|箇条書き)/.test(n)) ||
    /(お手伝い|対応範囲|できることリスト)/.test(n)
  ) {
    return true;
  }

  return false;
}

export async function buildWhatsNewDraft(db: Db): Promise<string> {
  const env = getEnv();
  const lines = await listCapabilityLines(db);
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
