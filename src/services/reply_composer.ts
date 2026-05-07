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
  /** 発言者の表示名（LINE Profile）。自然な呼びかけに使う（任意） */
  actorDisplayName?: string;
};

function temperatureForSituation(s: ComposeInput["situation"]): number {
  switch (s) {
    case "success":
    case "followup":
      return 0.84;
    case "unsupported":
      return 0.72;
    case "error":
      return 0.62;
    default:
      return 0.76;
  }
}

function recentOpeningGuards(messages?: string[]): string[] {
  if (!messages?.length) return [];
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < 3; i--) {
    const line = messages[i]
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    if (!line) continue;
    const normalized = line.replace(/[「」『』。、！!？?\s]/g, "");
    if (!normalized) continue;
    const head = normalized.slice(0, 14);
    if (head.length >= 5 && !out.includes(head)) out.push(head);
  }
  return out;
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
    if (input.actorDisplayName?.trim()) {
      userBits.push(
        "",
        `ユーザーの表示名: ${input.actorDisplayName.trim()}`,
        "- 自然な流れで名前を呼んでよい（毎回冒頭に付けなくてもよい。文中に1回入れる程度）。"
      );
    }
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
    const openingGuards = recentOpeningGuards(input.recentAssistantMessages);
    if (openingGuards.length > 0) {
      userBits.push(
        "",
        "直近と同じテンプレ感を避けるため、次の書き出し（先頭付近）は繰り返さない:",
        ...openingGuards.map((s, i) => `${i + 1}. ${s}...`)
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
      frequency_penalty: 0.45,
      presence_penalty: 0.25,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) return text;
  } catch (e) {
    log.warn({ err: e }, "composeNearReply failed, using draft");
  }
  return input.draft;
}

/**
 * 軽微整形: 口調・改行のみ。数値・固有名・箇条書きの内容は変えない。前置きを足さない。
 */
export async function composeNearReplyLight(input: ComposeInput): Promise<string> {
  const env = getEnv();
  const log = getLogger();

  if (input.situation === "success" && SHEET_READ_SUCCESS_HEADER_REGEX.test(input.draft)) {
    return input.draft;
  }

  const persona = await getPersona();

  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const userBits: string[] = [
      `状況: ${input.situation}`,
      "次のドラフトはユーザーへの返信本文です。**内容・数値・固有名・箇条書きの事実は1文字も変えず**、改行と丁寧さだけ整えてください。",
      "- 新しい情報・前置き・「調べたところ」などの追加は禁止。",
      "- ドラフトが既に丁寧なら、ほぼそのままでよい。",
    ];
    if (input.userMessage?.trim()) {
      userBits.push("", `ユーザー発言（参考のみ）: ${input.userMessage.trim()}`);
    }
    userBits.push("", "【ドラフト】", input.draft);

    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        { role: "system", content: persona },
        { role: "user", content: userBits.join("\n") },
      ],
      max_tokens: 380,
      temperature: 0.28,
      frequency_penalty: 0.2,
      presence_penalty: 0.1,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) return text;
  } catch (e) {
    log.warn({ err: e }, "composeNearReplyLight failed, using draft");
  }
  return input.draft;
}
