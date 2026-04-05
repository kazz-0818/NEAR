import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { getLogger } from "../lib/logger.js";

let personaCache: string | null = null;

async function getPersona(): Promise<string> {
  if (personaCache) return personaCache;
  personaCache = await loadPrompt("prompts/near.persona.md");
  return personaCache;
}

export type ComposeInput = {
  /** ユーザーへの最終メッセージの骨子（モジュール出力やテンプレ） */
  draft: string;
  /** 状況: success | unsupported | error | followup */
  situation: "success" | "unsupported" | "error" | "followup";
  /** ユーザーのその発言。言い回しのバリエーション・軽い相槌に使う（任意） */
  userMessage?: string;
  /** 今回より前のユーザー発言（古い順）。話題の踏襲用（任意） */
  recentUserMessages?: string[];
};

function temperatureForSituation(s: ComposeInput["situation"]): number {
  switch (s) {
    case "success":
    case "followup":
      return 0.78;
    case "unsupported":
      return 0.64;
    case "error":
      return 0.55;
    default:
      return 0.7;
  }
}

export async function composeNearReply(input: ComposeInput): Promise<string> {
  const env = getEnv();
  const log = getLogger();
  const persona = await getPersona();

  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const userBits: string[] = [
      `状況: ${input.situation}`,
      "次のドラフトは骨子です。NEARの口調で1通にまとめてください。",
      "- 事実・約束・次のアクション・列挙する内容はドラフトどおり。",
      "- 表現・導入・つかみ・軽いユーモアや一言ツッコミは毎回変えてよい。決まり文句だけの返答は避ける。",
      "- ユーザーの発言があれば、長くならない範囲で軽く拾ってよい。",
      "- 読みやすいよう改行を入れる。",
    ];
    if (input.userMessage?.trim()) {
      userBits.push("", `ユーザー発言: ${input.userMessage.trim()}`);
    }
    if (input.recentUserMessages?.length) {
      userBits.push(
        "",
        "このトークで今回より前のユーザー発言（古い順・参考。話題の継続に使う）:"
      );
      for (let i = 0; i < input.recentUserMessages.length; i++) {
        userBits.push(`${i + 1}. ${input.recentUserMessages[i]}`);
      }
      userBits.push(
        "",
        "直前の発言とドラフトの内容がずれないように。事実・手順・約束はドラフトを優先。"
      );
    }
    userBits.push("", "【ドラフト】", input.draft);
    if (input.situation === "unsupported") {
      userBits.push(
        "",
        "【未対応時の追加ルール】ドラフトに既に謝意と「記録した」旨がある。**同じ意味の断りを繰り返さない**。**「成長」ネタで盛らない**（ドラフトに書いてある事実だけ）。全体は**短く**（目安3〜5文）。"
      );
    }
    const sheetsSuccess = input.situation === "success" && /（参照:\s*シート「/.test(input.draft);
    if (sheetsSuccess) {
      userBits.push(
        "",
        "【スプレッドシート参照成功】ドラフトは**ユーザー指示に沿って**シートを読み取り整形した結果です。「リンクを開けない」等**アクセス不能の断りは禁止**。**体裁・見出し・段落/箇条書きの比率はドラフトどおり維持**し、勝手に一覧だけに組み換えない。**数値・結論・根拠は省略しない**。ユーザーが短文・報告調・締めなしの指定ならそのまま。指定がなければ導入・締めを短く NEAR 口調に整えてよい。"
      );
    }

    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        { role: "system", content: persona },
        {
          role: "user",
          content: userBits.join("\n"),
        },
      ],
      max_tokens: sheetsSuccess ? 1100 : 520,
      temperature: temperatureForSituation(input.situation),
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) return text;
  } catch (e) {
    log.warn({ err: e }, "composeNearReply failed, using draft");
  }
  return input.draft;
}
