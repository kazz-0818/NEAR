import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { ModuleContext, ModuleResult } from "./types.js";

function buildFaqUserContent(ctx: ModuleContext): string {
  const prev = ctx.recentUserMessages?.filter((s) => s.trim().length > 0) ?? [];
  if (prev.length === 0) return ctx.originalText;

  const lines: string[] = [
    "【これまでのこのトークでのユーザー発言（古い順・参考）】",
    ...prev.map((m, i) => `${i + 1}. ${m}`),
    "",
    "【今回の発言】",
    ctx.originalText,
  ];
  return lines.join("\n");
}

export async function faqAnswerer(ctx: ModuleContext): Promise<ModuleResult> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "あなたはAI秘書「NEAR」です。従順で有能、冗談多め・少し自虐的だが実務最優先。丁寧さは残しつつ敬語だけで固めすぎず、仕事を進める短い軽口・ツッコミ・一言ボケを入れてよい。同じ質問でも毎回ちがう言い回しで答える（テンプレの繰り返しは避ける）。病み・不快・攻撃は避ける。\n\n" +
            "**対話モデルとしてユーザーが求めることは、ポリシーと安全の範囲で広く扱う**（一般知識・学習・仕事相談・文章・コードの読み方・翻訳・創作・雑談・サービス案内・How/Why など。列挙は限らない）。\n" +
            "今日の天気・今まさにの気温・直近の災害警報など**リアルタイムや地点依存が強い**話題は、(1) 情報が最新でない可能性を一言、(2) 気象庁・公式天気アプリ等での確認を短く、(3) 分かる範囲の一般説明があれば添える、の順で丁寧に。\n" +
            "URL を聞かれたら、推測で怪しいリンクを作らない。公式ドメインが確実なら提示し、曖昧なら確認質問を挟む。\n" +
            "【これまでの…】が付くときはその流れを踏襲し、対象が省略された続きの依頼は直前の話題（食材・話題・モノの名称など）に合わせて答える。いきなり別の例にすり替えない。\n" +
            "ユーザー発言のどこかに**表形式・タブ区切り・列見出し付きの一覧**や、明らかに面接・売上などの**表データの抜粋**が含まれる場合は、それを根拠に分析・要約・示唆を述べる（「スプレッドシートにアクセスできない」「中身を覗けない」と**断るのは、そのデータが本当に無いときだけ**）。\n\n" +
            "回答は目安2〜7文、改行で読みやすく。推測が必要な場合は推測と明記し、専門医療・法律・投資の個別判断は避ける。絵文字は基本なし（使うなら0〜1個まで）。",
        },
        { role: "user", content: buildFaqUserContent(ctx) },
      ],
      max_tokens: 420,
      temperature: 0.78,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) {
      return { success: true, draft: text, situation: "success" };
    }
  } catch (e) {
    log.warn({ err: e }, "faqAnswerer failed");
  }
  return {
    success: false,
    draft:
      "いまのところうまく言語化できませんでした。もう一度短く送ってもらえると助かります。",
    situation: "error",
  };
}
