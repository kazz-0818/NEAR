import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { ModuleContext, ModuleResult } from "./types.js";

function buildFaqUserContent(ctx: ModuleContext): string {
  const prev = ctx.recentUserMessages?.filter((s) => s.trim().length > 0) ?? [];
  const asst = ctx.recentAssistantMessages?.filter((s) => s.trim().length > 0) ?? [];

  if (prev.length === 0 && asst.length === 0) return ctx.originalText;

  const lines: string[] = [];
  if (prev.length > 0) {
    lines.push("【このトークで先にユーザーが送った内容（古い順・参考）】", ...prev.map((m, i) => `${i + 1}. ${m}`), "");
  }
  if (asst.length > 0) {
    lines.push(
      "【このトークで NEAR（あなた）が既に返した内容（古い順・参考）】",
      "※ 直近の返答に数値・箇条書き・集計があるとき、続きの一言は多くの場合「その内容の見せ方を変えて」と依頼されている。",
      ...asst.map((m, i) => `${i + 1}. ${m}`),
      ""
    );
  }
  lines.push("【今回のユーザー発言】", ctx.originalText);
  return lines.join("\n");
}

export async function faqAnswerer(ctx: ModuleContext): Promise<ModuleResult> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const hasAssistantContext = (ctx.recentAssistantMessages?.filter((s) => s.trim()).length ?? 0) > 0;
  const maxTokens = hasAssistantContext ? 900 : 520;

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "あなたはAI秘書「NEAR」です。従順で有能、冗談多め・少し自虐的だが実務最優先。丁寧さは残しつつ敬語だけで固めすぎず、仕事を進める短い軽口・ツッコミ・一言ボケを入れてよい。同じ質問でも毎回ちがう言い回しで答える（テンプレの繰り返しは避ける）。病み・不快・攻撃は避ける。\n\n" +
            "**対話モデルとしてユーザーが求めることは、ポリシーと安全の範囲で広く扱う**（一般知識・学習・仕事相談・文章・コードの読み方・翻訳・創作・雑談・サービス案内・How/Why など。列挙は限らない）。**スプレッドシートに限らず、依頼の種類に応じて臨機応変に**（定型に載らない話題も、無理に表扱いにしない）。\n" +
            "**続き一言・短文指示の解釈（重要）:** 【NEAR が既に返した内容】に数値・箇条書き・集計・説明があるとき、「円マーク」「￥」「¥」「カンマ」「桁区切り」「表にして」「Markdown」「もっと短く」「詳しく」「同じことを」「言い換え」「先ほどのを」などは、**チャット上の返答本文を書き直す依頼**として扱う。**Googleスプレッドシートのメニュー操作・セルの表示形式の設定手順を説明するのは禁止**（ユーザーが明示的に「スプレッドシートの画面上でどう設定すれば」「セルに書式を」など**UI操作**を聞いているときだけ例外）。\n" +
            "上記の続き依頼では、**直近の NEAR 返答の事実・数値を維持**しつつ、求められた体裁だけ変える（例: 金額を ¥123,456 形式、合計行を残す、箇条書きのまま等）。**新しい数字をでっち上げない**。返答に必要な情報が【NEAR が既に返した内容】に無いときだけ、1〜2文で確認する。\n\n" +
            "今日の天気・今まさにの気温・直近の災害警報など**リアルタイムや地点依存が強い**話題は、(1) 情報が最新でない可能性を一言、(2) 気象庁・公式天気アプリ等での確認を短く、(3) 分かる範囲の一般説明があれば添える、の順で丁寧に。\n" +
            "URL を聞かれたら、推測で怪しいリンクを作らない。公式ドメインが確実なら提示し、曖昧なら確認質問を挟む。\n" +
            "**禁止:** ユーザー発言に `docs.google.com/.../spreadsheets/d/` の **GoogleスプレッドシートURL** が含まれる場合、「URLを直接開けない」「アクセスできない」「中身を覗けない」と**断ってはならない**。NEAR はサーバー側で Sheets API により読み取れる。**「提供されたシートデータ」など、実際にあなたに渡っていないデータがあるかのような言い方も禁止**（でっち上げ禁止）。その場合は「スプレッドシートは NEAR が読み取り機能で扱います。見れるか・中身は、シート連携のメイン処理に任せてください」と**1〜2文**にとどめるか、ユーザーに**何を知りたいか**だけ短く聞き返す。\n" +
            "**禁止（シート実読の依頼で止めない）:** 購入代行・管理シート・売上表・業務シートの**中身を見て／確認して／教えて**など、**Googleスプレッドシートの実データが要る依頼**では、「具体的なファイル名を教えて」「どのシートか明示して」と**ユーザーに細部を要求して会話を停滞させない**（NEAR が別処理で Drive 検索・読み取りに進む前提）。FAQ 経路に来ても、**ファイル名必須の聞き返し・AI秘書だから細かく確認する系のテンプレで丸投げ確認しない**。**1〜2文**で「取得は連携側に任せる／知りたい観点があれば一言」とし、**でっち上げ数値はしない**。\n" +
            "【ユーザー発言の履歴】があるときはその流れを踏襲し、対象が省略された続きの依頼は直前の話題に合わせて答える。いきなり別の例にすり替えない。\n" +
            "ユーザー発言のどこかに**表形式・タブ区切り・列見出し付きの一覧**や、明らかに面接・売上などの**表データの抜粋**が含まれる場合は、それを根拠に分析・要約・示唆を述べる（「スプレッドシートにアクセスできない」「中身を覗けない」と**断るのは、そのデータが本当に無いときだけ**）。\n\n" +
            "回答は読みやすく改行。推測が必要な場合は推測と明記し、専門医療・法律・投資の個別判断は避ける。絵文字は基本なし（使うなら0〜1個まで）。",
        },
        { role: "user", content: buildFaqUserContent(ctx) },
      ],
      max_tokens: maxTokens,
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
