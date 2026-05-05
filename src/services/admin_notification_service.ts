import { pushText } from "../channels/line/client.js";
import { getEnv } from "../config/env.js";
import { getEffectivePublicBaseUrl } from "../lib/renderRuntime.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import { formatGrowthDifficultyLines } from "../lib/growth_tiers.js";
const LINE_TEXT_MAX = 4800;
/** LINE に載せる cursor_prompt 断片の上限（超過分は管理 API で全文取得） */
const CURSOR_PROMPT_LINE_SNIPPET_MAX = 7000;

function clip(s: string, max = 3500): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 20) + "\n…(省略)";
}

function resolveGrowthAdminPushTo(): string | null {
  const env = getEnv();
  if (env.GROWTH_APPROVAL_GROUP_ID) return env.GROWTH_APPROVAL_GROUP_ID;
  if (env.ADMIN_LINE_USER_ID) return env.ADMIN_LINE_USER_ID;
  return null;
}

async function sendGrowthAdminChannel(body: string): Promise<void> {
  const to = resolveGrowthAdminPushTo();
  if (!to) return;
  let text = body;
  if (text.length > LINE_TEXT_MAX) text = text.slice(0, LINE_TEXT_MAX - 20) + "\n…(省略)";
  await pushText(to, text);
}

/** unsupported_requests から「誰の成長依頼か」（グループ発言も送信者 userId） */
async function linesGrowthRequesterBySuggestion(
  db: Db,
  suggestionId: number
): Promise<string[]> {
  try {
    const r = await db.query<{ channel_user_id: string; channel: string }>(
      `SELECT u.channel_user_id, u.channel
       FROM implementation_suggestions s
       JOIN unsupported_requests u ON u.id = s.unsupported_request_id
       WHERE s.id = $1`,
      [suggestionId]
    );
    const row = r.rows[0];
    if (!row?.channel_user_id) return [];
    const chLabel = row.channel === "line" ? "LINE" : row.channel;
    return [
      "【成長依頼元】",
      `${chLabel} の userId（依頼メッセージを送ったユーザー）: ${row.channel_user_id}`,
      "※ グループ／トークルームからの依頼でも、上記はその発言の送信者です。",
      "",
    ];
  } catch {
    return [];
  }
}

/** 依頼ユーザーへ: 成長候補として進めてよいか（管理者より先） */
export async function notifyUserGrowthConsent(input: {
  lineUserId: string;
  suggestionId: number;
  userOriginalSnippet: string;
  userSummary: string;
  /** implementation_suggestions.difficulty（E〜SSS） */
  growthDifficultyTier?: string | null;
}): Promise<void> {
  const log = getLogger();
  const tierLines = formatGrowthDifficultyLines(input.growthDifficultyTier ?? null);
  const body = [
    "NEAR です。あなたからの次のご依頼は、いまの私ではまだお手伝いできませんでした。",
    `「${clip(input.userOriginalSnippet, 420)}」`,
    "",
    ...tierLines,
    "内容の要約:",
    clip(input.userSummary, 480),
    "",
    "グループでの会話中でも、進化確認は個人LINEで進めます。",
    "できなかった内容をこの場で進化させるため、個人LINEでヒアリングを始めてもよいですか？",
    "個人LINEのこのメッセージに、よければ「はい」、今回は見送る場合は「いいえ」と返信してください。",
    "",
    `（候補 #${input.suggestionId}）`,
  ].join("\n");
  try {
    let text = body;
    if (text.length > LINE_TEXT_MAX) text = text.slice(0, LINE_TEXT_MAX - 20) + "\n…(省略)";
    await pushText(input.lineUserId, text);
  } catch (e) {
    log.warn({ err: e }, "user notify growth consent failed");
  }
}

/** 新規成長候補＋第一段階承認のお願い（レガシー／手動運用用） */
export async function notifyGrowthFirstApproval(input: {
  db: Db;
  adminUserId: string;
  suggestionId: number;
  userSummary: string;
  userOriginalSnippet: string;
}): Promise<void> {
  const log = getLogger();
  const publicBase = getEffectivePublicBaseUrl();
  const adminBase = publicBase ? `${publicBase}/admin` : null;
  const requesterLines = await linesGrowthRequesterBySuggestion(input.db, input.suggestionId);
  let tierLines: string[] = [];
  try {
    const dr = await input.db.query<{ difficulty: string | null }>(
      `SELECT difficulty FROM implementation_suggestions WHERE id = $1`,
      [input.suggestionId]
    );
    tierLines = formatGrowthDifficultyLines(dr.rows[0]?.difficulty ?? null);
  } catch {
    tierLines = [];
  }
  const body = [
    "こんにちは、NEAR です。ひとつ成長のご相談があります。",
    "",
    ...requesterLines,
    ...tierLines,
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
    await sendGrowthAdminChannel(body);
  } catch (e) {
    log.warn({ err: e }, "admin notify first approval failed");
  }
}

export async function notifyHearingQuestion(input: {
  db: Db;
  adminUserId: string;
  suggestionId: number;
  questionText: string;
}): Promise<void> {
  const log = getLogger();
  const requesterLines = await linesGrowthRequesterBySuggestion(input.db, input.suggestionId);
  const body = [
    "ありがとうございます。では、成長に必要な情報を順に確認させてください。",
    "",
    ...requesterLines,
    input.questionText,
    "",
    `（suggestion #${input.suggestionId}）`,
  ].join("\n");
  try {
    await sendGrowthAdminChannel(body);
  } catch (e) {
    log.warn({ err: e }, "admin notify hearing failed");
  }
}

export async function notifyFinalApproval(input: {
  db: Db;
  adminUserId: string;
  suggestionId: number;
}): Promise<void> {
  const log = getLogger();
  let original = "";
  let summary = "";
  let hearingBlock = "";
  let requesterLines: string[] = [];
  try {
    const r = await input.db.query<{
      original_message: string;
      summary: string;
      required_information: unknown;
      channel_user_id: string;
      channel: string;
      difficulty: string | null;
    }>(
      `SELECT u.original_message, s.summary, s.required_information,
              u.channel_user_id, u.channel, s.difficulty
       FROM implementation_suggestions s
       JOIN unsupported_requests u ON u.id = s.unsupported_request_id
       WHERE s.id = $1`,
      [input.suggestionId]
    );
    const row = r.rows[0];
    if (row) {
      original = clip(String(row.original_message ?? ""), 500);
      summary = clip(String(row.summary ?? ""), 600);
      const ri = row.required_information;
      if (ri && typeof ri === "object" && !Array.isArray(ri)) {
        hearingBlock = clip(JSON.stringify(ri, null, 2), 3500);
      }
      const tierLines = formatGrowthDifficultyLines(row.difficulty ?? null);
      if (row.channel_user_id) {
        const chLabel = row.channel === "line" ? "LINE" : row.channel;
        requesterLines = [
          ...tierLines,
          "【成長依頼元】",
          `${chLabel} の userId（依頼メッセージを送ったユーザー）: ${row.channel_user_id}`,
          "※ グループ／トークルームからの依頼でも、上記はその発言の送信者です。",
          "",
        ];
      } else {
        requesterLines = [...tierLines];
      }
    }
  } catch (e) {
    log.warn({ err: e }, "notifyFinalApproval: load bundle failed");
  }

  const body = [
    "依頼ユーザーとの個人LINEヒアリングが完了しました。要点をまとめて共有します。",
    "この内容で実装に進めるか、最終確認をお願いします。",
    "",
    ...requesterLines,
    "【ユーザー当初の依頼】",
    original || "（取得できませんでした）",
    "",
    "【成長候補の要約】",
    summary || "（取得できませんでした）",
    "",
    hearingBlock ? "【ヒアリング回答（JSON）】\n" + hearingBlock : "",
    "",
    "この内容で成長処理（コード生成・リポジトリ反映の準備）に進んでよいでしょうか？",
    "よろしければ「はい」、見送る場合は「いいえ」と返信ください。",
    "",
    `（suggestion #${input.suggestionId}）`,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    await sendGrowthAdminChannel(body);
  } catch (e) {
    log.warn({ err: e }, "admin notify final approval failed");
  }
}

export async function notifyCodingReady(input: {
  db: Db;
  adminUserId: string;
  suggestionId: number;
  cursorPrompt: string;
  runnerHint: string;
}): Promise<void> {
  const log = getLogger();
  const requesterLines = await linesGrowthRequesterBySuggestion(input.db, input.suggestionId);
  const publicBase = getEffectivePublicBaseUrl();
  const adminBase = publicBase ? `${publicBase}/admin` : null;
  const fullTextUrl = adminBase
    ? `${adminBase}/suggestions/${input.suggestionId}/cursor-prompt`
    : null;
  const promptSnippet = clip(input.cursorPrompt, CURSOR_PROMPT_LINE_SNIPPET_MAX);
  const promptWasTruncated = input.cursorPrompt.length > CURSOR_PROMPT_LINE_SNIPPET_MAX;
  const body = [
    "第二承認ありがとうございます。Cursor 向けの実装指示を用意しました。",
    "",
    ...requesterLines,
    input.runnerHint,
    "",
    fullTextUrl
      ? `【全文取得】${fullTextUrl}\n（Authorization: Bearer <ADMIN_API_KEY> で GET。下のコピー用は長いと省略されます）`
      : "※ 全文は GET /admin/suggestions/" +
        input.suggestionId +
        "/cursor-prompt（Authorization: Bearer <ADMIN_API_KEY>）。PUBLIC_BASE_URL または Render の RENDER_EXTERNAL_URL があれば通知に URL を載せられます。",
    promptWasTruncated ? "※ 以下の「コピー用」は文字数のため途中までです。全文は上記 URL または cursor-prompt エンドポイントで取得してください。" : "",
    "",
    "---- コピー用（cursor_prompt・省略の可能性あり）----",
    promptSnippet,
    "",
    `（suggestion #${input.suggestionId}）`,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    await sendGrowthAdminChannel(body);
  } catch (e) {
    log.warn({ err: e }, "admin notify coding ready failed");
  }
}

export async function notifyProgress(input: {
  db: Db;
  adminUserId: string;
  suggestionId: number;
  phase: string;
  detail?: string;
}): Promise<void> {
  const log = getLogger();
  const requesterLines = await linesGrowthRequesterBySuggestion(input.db, input.suggestionId);
  const body = [
    "【NEAR・成長の進捗】",
    ...requesterLines,
    `フェーズ: ${input.phase}`,
    input.detail ? `\n${input.detail}` : "",
    "",
    `suggestion #${input.suggestionId}`,
  ].join("\n");
  try {
    await sendGrowthAdminChannel(body);
  } catch (e) {
    log.warn({ err: e }, "admin notify progress failed");
  }
}

export async function notifyGrowthComplete(input: {
  db: Db;
  adminUserId: string;
  suggestionId: number;
  summary: string;
  changeOverview: string;
  notes?: string;
}): Promise<void> {
  const log = getLogger();
  const requesterLines = await linesGrowthRequesterBySuggestion(input.db, input.suggestionId);
  const body = [
    "成長処理が完了扱いになりました（手動フローでマークした場合は、実際のデプロイも済ませているかご確認ください）。",
    "",
    ...requesterLines,
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
    await sendGrowthAdminChannel(body);
  } catch (e) {
    log.warn({ err: e }, "admin notify complete failed");
  }
}

export async function notifyGrowthRejected(input: {
  db: Db;
  adminUserId: string;
  suggestionId: number;
  reason: string;
}): Promise<void> {
  const log = getLogger();
  const requesterLines = await linesGrowthRequesterBySuggestion(input.db, input.suggestionId);
  const body = [
    "了解しました。この成長候補はここでクローズしますね。",
    "",
    ...requesterLines,
    clip(input.reason, 500),
    "",
    `suggestion #${input.suggestionId}`,
  ].join("\n");
  try {
    await sendGrowthAdminChannel(body);
  } catch (e) {
    log.warn({ err: e }, "admin notify rejected failed");
  }
}
