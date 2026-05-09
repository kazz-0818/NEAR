import { getEnv } from "../../config/env.js";
import { getLogger } from "../../lib/logger.js";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

/** LINE テキストメッセージの上限は 5000 文字。超えると API エラーになり無返信になるため安全にカットする */
const LINE_TEXT_MAX_CHARS = 5000;
const LINE_TEXT_TRUNCATION_SUFFIX = "\n…（文字数の上限に達したため、続きは分けて聞いてください）";

export type LineSendResult = {
  sentMessageIds: string[];
  via: "reply" | "push";
};

function safeTruncateLineText(text: string): string {
  if ([...text].length <= LINE_TEXT_MAX_CHARS) return text;
  const limit = LINE_TEXT_MAX_CHARS - [...LINE_TEXT_TRUNCATION_SUFFIX].length;
  return [...text].slice(0, limit).join("") + LINE_TEXT_TRUNCATION_SUFFIX;
}

function extractSentMessageIds(responseBody: unknown): string[] {
  if (!responseBody || typeof responseBody !== "object") return [];
  const sent = (responseBody as Record<string, unknown>).sentMessages;
  if (!Array.isArray(sent)) return [];
  return sent
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>).id : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function replyText(replyToken: string, text: string): Promise<LineSendResult> {
  const env = getEnv();
  const log = getLogger();
  const body = {
    replyToken,
    messages: [{ type: "text", text: safeTruncateLineText(text) }],
  };
  const res = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    log.error({ status: res.status, errText }, "LINE reply failed");
    throw new Error(`LINE reply failed: ${res.status}`);
  }
  const responseJson = await res.json().catch(() => null);
  return { sentMessageIds: extractSentMessageIds(responseJson), via: "reply" };
}

/**
 * まず reply（無料・低遅延）。失効・エラー時は push にフォールバック（返信が消えるのを防ぐ）。
 */
export async function replyOrPush(replyToken: string, lineUserId: string, text: string): Promise<LineSendResult> {
  const log = getLogger();
  try {
    return await replyText(replyToken, text);
  } catch (e) {
    log.warn({ err: e }, "LINE reply failed, falling back to push");
  }
  return await pushText(lineUserId, text);
}

export async function pushText(userId: string, text: string): Promise<LineSendResult> {
  const env = getEnv();
  const log = getLogger();
  const body = {
    to: userId,
    messages: [{ type: "text", text: safeTruncateLineText(text) }],
  };
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    log.error({ status: res.status, errText }, "LINE push failed");
    throw new Error(`LINE push failed: ${res.status}`);
  }
  const responseJson = await res.json().catch(() => null);
  return { sentMessageIds: extractSentMessageIds(responseJson), via: "push" };
}
