import { pushText } from "../channels/line/client.js";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";

const LINE_TEXT_MAX = 4800;

function clip(s: string, max = 3500): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 20) + "\n…(省略)";
}

async function send(adminUserId: string, body: string): Promise<void> {
  let text = body;
  if (text.length > LINE_TEXT_MAX) text = text.slice(0, LINE_TEXT_MAX - 20) + "\n…(省略)";
  await pushText(adminUserId, text);
}

/** 新規成長候補＋第一段階承認のお願い */
export async function notifyGrowthFirstApproval(input: {
  db: Db;
  adminUserId: string;
  suggestionId: number;
  userSummary: string;
  userOriginalSnippet: string;
}): Promise<void> {
  const env = getEnv();
  const log = getLogger();
  const adminBase = env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL}/admin` : null;
  const body = [
    "こんにちは、NEAR です。ひとつ成長のご相談があります。",
    "",
    `ご利用者の方から、次のようなお願いがありました（いまの私ではまだお手伝いできませんでした）。`,
    `「${clip(input.userOriginalSnippet, 400)}」`,
    "",
    "内容の要約:",
    clip(input.userSummary, 500),
    "",
    "この機能を、わたしの「成長候補」として進めてもよろしいでしょうか？",
    "よろしければ「はい」、見送りなら「いいえ」と返信ください。",
    "",
    `suggestion #${input.suggestionId}`,
    adminBase ? `管理API: ${adminBase}/suggestions/${input.suggestionId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    await send(input.adminUserId, body);
  } catch (e) {
    log.warn({ err: e }, "admin notify first approval failed");
  }
}

export async function notifyHearingQuestion(input: {
  adminUserId: string;
  suggestionId: number;
  questionText: string;
}): Promise<void> {
  const log = getLogger();
  const body = [
    "ありがとうございます。では、成長に必要な情報を順に確認させてください。",
    "",
    input.questionText,
    "",
    `（suggestion #${input.suggestionId}）`,
  ].join("\n");
  try {
    await send(input.adminUserId, body);
  } catch (e) {
    log.warn({ err: e }, "admin notify hearing failed");
  }
}

export async function notifyFinalApproval(input: {
  adminUserId: string;
  suggestionId: number;
}): Promise<void> {
  const log = getLogger();
  const body = [
    "必要な情報がそろいました。",
    "この内容で、成長処理（コード生成・リポジトリ反映の準備）に進んでよいでしょうか？",
    "よろしければ「はい」、調整したい場合は「いいえ」と返信ください。",
    "",
    `（suggestion #${input.suggestionId}）`,
  ].join("\n");
  try {
    await send(input.adminUserId, body);
  } catch (e) {
    log.warn({ err: e }, "admin notify final approval failed");
  }
}

export async function notifyCodingReady(input: {
  adminUserId: string;
  suggestionId: number;
  cursorPrompt: string;
  runnerHint: string;
}): Promise<void> {
  const log = getLogger();
  const body = [
    "第二承認ありがとうございます。Cursor 向けの実装指示を用意しました。",
    "",
    input.runnerHint,
    "",
    "---- コピー用（cursor_prompt）----",
    clip(input.cursorPrompt, 7000),
    "",
    `（suggestion #${input.suggestionId}）`,
  ].join("\n");
  try {
    await send(input.adminUserId, body);
  } catch (e) {
    log.warn({ err: e }, "admin notify coding ready failed");
  }
}

export async function notifyProgress(input: {
  adminUserId: string;
  suggestionId: number;
  phase: string;
  detail?: string;
}): Promise<void> {
  const log = getLogger();
  const body = [
    "【NEAR・成長の進捗】",
    `フェーズ: ${input.phase}`,
    input.detail ? `\n${input.detail}` : "",
    "",
    `suggestion #${input.suggestionId}`,
  ].join("\n");
  try {
    await send(input.adminUserId, body);
  } catch (e) {
    log.warn({ err: e }, "admin notify progress failed");
  }
}

export async function notifyGrowthComplete(input: {
  adminUserId: string;
  suggestionId: number;
  summary: string;
  changeOverview: string;
  notes?: string;
}): Promise<void> {
  const log = getLogger();
  const body = [
    "成長処理が完了扱いになりました（手動フローでマークした場合は、実際のデプロイも済ませているかご確認ください）。",
    "",
    "追加・反映したい機能の要約:",
    clip(input.summary, 600),
    "",
    "変更概要:",
    clip(input.changeOverview, 800),
    input.notes ? `\n注意点:\n${clip(input.notes, 400)}` : "",
    "",
    `suggestion #${input.suggestionId}`,
  ].join("\n");
  try {
    await send(input.adminUserId, body);
  } catch (e) {
    log.warn({ err: e }, "admin notify complete failed");
  }
}

export async function notifyGrowthRejected(input: {
  adminUserId: string;
  suggestionId: number;
  reason: string;
}): Promise<void> {
  const log = getLogger();
  const body = [
    "了解しました。この成長候補はここでクローズしますね。",
    clip(input.reason, 500),
    "",
    `suggestion #${input.suggestionId}`,
  ].join("\n");
  try {
    await send(input.adminUserId, body);
  } catch (e) {
    log.warn({ err: e }, "admin notify rejected failed");
  }
}
