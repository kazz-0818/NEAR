import { getEnv } from "../../config/env.js";
import { getLogger } from "../../lib/logger.js";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

export async function replyText(replyToken: string, text: string): Promise<void> {
  const env = getEnv();
  const log = getLogger();
  const body = {
    replyToken,
    messages: [{ type: "text", text }],
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
}

/**
 * まず reply（無料・低遅延）。失効・エラー時は push にフォールバック（返信が消えるのを防ぐ）。
 */
export async function replyOrPush(replyToken: string, lineUserId: string, text: string): Promise<void> {
  const log = getLogger();
  try {
    await replyText(replyToken, text);
    return;
  } catch (e) {
    log.warn({ err: e }, "LINE reply failed, falling back to push");
  }
  await pushText(lineUserId, text);
}

export async function pushText(userId: string, text: string): Promise<void> {
  const env = getEnv();
  const log = getLogger();
  const body = {
    to: userId,
    messages: [{ type: "text", text }],
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
}
