import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { SHEET_READ_SUCCESS_HEADER_REGEX } from "../lib/sheetReplyMarker.js";
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
  /** 今回より前の NEAR 返答（古い順）。続きの整形依頼の文脈用（任意） */
  recentAssistantMessages?: string[];
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

  // シート読取成功ドラフトは API 済みの事実が本文に含まれる。ペルソナ整形で「リンクを開けない」等が
  // 付くと論理矛盾になるため、そのまま返す（answerWithLlm 側で NEAR 口調の土台はある）。
  const sheetsSuccess =
    input.situation === "success" && SHEET_READ_SUCCESS_HEADER_REGEX.test(input.draft);
  if (sheetsSuccess) {
    return input.draft;
  }

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
    if (input.recentAssistantMessages?.length) {
      userBits.push(
        "",
        "このトークで今回より前の NEAR の返答（古い順・参考）:"
      );
      for (let i = 0; i < input.recentAssistantMessages.length; i++) {
        userBits.push(`${i + 1}. ${input.recentAssistantMessages[i]}`);
      }
      userBits.push(
        "",
        "ユーザーが直前の返答の見せ方だけを変えているときは、ドラフトの数値・事実を変えず体裁だけ整える。"
      );
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
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        { role: "system", content: persona },
        {
          role: "user",
          content: userBits.join("\n"),
        },
      ],
      max_tokens: 520,
      temperature: temperatureForSituation(input.situation),
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) return text;
  } catch (e) {
    log.warn({ err: e }, "composeNearReply failed, using draft");
  }
  return input.draft;
}
