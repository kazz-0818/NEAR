import OpenAI from "openai";
import type { Db } from "../db/client.js";
import { getEnv } from "../config/env.js";
import {
  extractSpreadsheetIdFromText,
  getServiceAccountClientEmail,
  getSheetsAPI,
  googleSheetsConfigured,
} from "../lib/googleSheetsAuth.js";
import { getLogger } from "../lib/logger.js";
import type { ParsedIntent } from "../models/intent.js";
import type { ModuleContext, ModuleResult } from "./types.js";

const SET_DEFAULT_RE =
  /(常用|既定|デフォルト|いつも|デフォ).{0,20}(スプレッド|シート)|(スプレッド|シート).{0,12}(常用|既定|デフォルト|いつも)/i;

const PICK_SHEET_SCHEMA = {
  name: "near_sheet_pick",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sheetTitle: { type: "string" },
      reasoning: { type: "string" },
    },
    required: ["sheetTitle", "reasoning"],
  },
} as const;

function paramSpreadsheetId(intent: ParsedIntent): string | null {
  const p = intent.required_params?.spreadsheet_id;
  return typeof p === "string" && /^[a-zA-Z0-9-_]{20,}$/.test(p.trim()) ? p.trim() : null;
}

function escapeSheetTitleForA1(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function valuesToTsv(rows: unknown[][] | null | undefined): string {
  if (!rows || rows.length === 0) return "(データなし)";
  return rows
    .map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))).join("\t") : ""))
    .join("\n");
}

function clipTsv(s: string, max = 28000): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 40) + "\n…(以降省略。必要なら範囲を指定してください)";
}

function resolveSheetTitle(pick: string, titles: string[]): string {
  const t = pick.trim();
  if (titles.includes(t)) return t;
  const lower = t.toLowerCase();
  const partial = titles.find(
    (x) =>
      x.toLowerCase().includes(lower) ||
      lower.includes(x.toLowerCase()) ||
      x.replace(/\s/g, "").toLowerCase().includes(lower.replace(/\s/g, ""))
  );
  if (partial) return partial;
  return titles[0] ?? t;
}

export async function loadUserSpreadsheetDefault(db: Db, lineUserId: string): Promise<string | null> {
  try {
    const r = await db.query<{ spreadsheet_id: string }>(
      `SELECT spreadsheet_id FROM user_sheet_defaults WHERE line_user_id = $1`,
      [lineUserId]
    );
    return r.rows[0]?.spreadsheet_id ?? null;
  } catch {
    return null;
  }
}

async function saveUserDefault(db: Db, lineUserId: string, spreadsheetId: string): Promise<void> {
  await db.query(
    `INSERT INTO user_sheet_defaults (line_user_id, spreadsheet_id, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (line_user_id) DO UPDATE SET
       spreadsheet_id = EXCLUDED.spreadsheet_id,
       updated_at = now()`,
    [lineUserId, spreadsheetId]
  );
}

async function pickSheetWithLlm(userQuestion: string, sheetTitles: string[]): Promise<string> {
  const env = getEnv();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const list = sheetTitles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const completion = await client.chat.completions.create({
    model: env.OPENAI_INTENT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "あなたはスプレッドシートのシート名選択器です。ユーザーの質問に答えるのに最も適切な1つのシート名を、次の一覧から選びます。一覧に完全一致する文字列を sheetTitle に入れてください。",
      },
      {
        role: "user",
        content: `質問:\n${userQuestion}\n\nシート一覧:\n${list}`,
      },
    ],
    response_format: { type: "json_schema", json_schema: PICK_SHEET_SCHEMA },
    max_tokens: 200,
    temperature: 0.2,
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) return sheetTitles[0] ?? "";
  const j = JSON.parse(raw) as { sheetTitle?: string };
  return typeof j.sheetTitle === "string" ? j.sheetTitle : sheetTitles[0] ?? "";
}

async function answerWithLlm(userQuestion: string, sheetTitle: string, tsv: string): Promise<string> {
  const env = getEnv();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: env.OPENAI_INTENT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "あなたはNEARです。ユーザー質問に、与えられた表データ（タブ区切り）だけを根拠に答えてください。数値・日付の集計が必要なら明示的に計算してください。データに無いことは推測せず、その旨を述べてください。簡潔に日本語で。",
      },
      {
        role: "user",
        content: `シート名: ${sheetTitle}\n\n質問:\n${userQuestion}\n\n表データ:\n${tsv}`,
      },
    ],
    max_tokens: 900,
    temperature: 0.35,
  });
  return completion.choices[0]?.message?.content?.trim() ?? "すみません、回答を組み立てられませんでした。";
}

export async function sheetsQuery(ctx: ModuleContext): Promise<ModuleResult> {
  const log = getLogger();
  const env = getEnv();

  if (!googleSheetsConfigured()) {
    return {
      success: false,
      draft:
        "Googleスプレッドシートを読む機能は、管理者がサービスアカウント連携（環境変数）を設定し、あなたのシートをそのアカウントに共有すると使えます。手順は NEAR の DEPLOY.md「Google スプレッドシート」を参照してください。",
      situation: "unsupported",
    };
  }

  const idFromMessage = extractSpreadsheetIdFromText(ctx.originalText);
  if (idFromMessage && SET_DEFAULT_RE.test(ctx.originalText)) {
    try {
      await saveUserDefault(ctx.db, ctx.channelUserId, idFromMessage);
      return {
        success: true,
        draft: `このスプレッドシートを、あなたの**既定**に保存しました。\n次から URL を省略して「POPUPシートの売上は？」のように聞いても試せます（他に既定が無い場合）。`,
        situation: "success",
      };
    } catch (e) {
      log.warn({ err: e }, "saveUserDefault failed");
    }
  }

  let spreadsheetId =
    paramSpreadsheetId(ctx.intent) ??
    idFromMessage ??
    (await loadUserSpreadsheetDefault(ctx.db, ctx.channelUserId)) ??
    env.GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID?.trim() ??
    null;

  if (!spreadsheetId) {
    return {
      success: true,
      draft:
        "どのスプレッドシートを見るか決められませんでした。\n" +
        "・Google の共有リンク（`https://docs.google.com/spreadsheets/d/...`）を送るか、\n" +
        "・管理者が `GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID` を設定しているか、\n" +
        "・一度「このシートを既定にして」とリンク付きで言って保存してください。",
      situation: "followup",
    };
  }

  const maxRows = env.GOOGLE_SHEETS_MAX_ROWS;

  try {
    const sheets = await getSheetsAPI();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });

    const titles =
      meta.data.sheets?.map((s) => s.properties?.title).filter((t): t is string => !!t && t.length > 0) ?? [];

    if (titles.length === 0) {
      return {
        success: false,
        draft: "ブック内にシートが見つかりませんでした。",
        situation: "error",
      };
    }

    const pickedRaw = await pickSheetWithLlm(ctx.originalText, titles);
    const sheetTitle = resolveSheetTitle(pickedRaw, titles);
    const rowCount =
      meta.data.sheets?.find((s) => s.properties?.title === sheetTitle)?.properties?.gridProperties?.rowCount ??
      maxRows;
    const lastRow = Math.min(Math.max(1, rowCount), maxRows);
    const range = `${escapeSheetTitleForA1(sheetTitle)}!A1:ZZ${lastRow}`;

    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const tsv = clipTsv(valuesToTsv(valuesRes.data.values as unknown[][]));
    const bookTitle = meta.data.properties?.title ?? "";
    const answer = await answerWithLlm(
      ctx.originalText + (bookTitle ? `\n（ブック名の参考: ${bookTitle}）` : ""),
      sheetTitle,
      tsv
    );

    const header =
      `（参照: シート「${sheetTitle}」の先頭〜${lastRow}行・列ZZまで。ブックID ${spreadsheetId.slice(0, 8)}…）\n\n`;
    return {
      success: true,
      draft: header + answer,
      situation: "success",
    };
  } catch (e: unknown) {
    const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : String(e);
    log.warn({ err: e, spreadsheetId: spreadsheetId.slice(0, 8) }, "sheetsQuery failed");

    if (/PERMISSION_DENIED|403/i.test(msg) || /The caller does not have permission/i.test(msg)) {
      const email = getServiceAccountClientEmail();
      const shareHint = email
        ? `スプレッドシートの「共有」で、次のサービスアカウントに**閲覧者**以上を追加してください:\n${email}`
        : "スプレッドシートを、NEAR 用サービスアカウントに共有してください（閲覧者以上）。";
      return {
        success: false,
        draft: `シートを読めませんでした（権限がありません）。\n${shareHint}`,
        situation: "error",
      };
    }

    if (/not found|NOT_FOUND|404/i.test(msg)) {
      return {
        success: false,
        draft: "スプレッドシートが見つかりません。ID かリンクが正しいか確認してください。",
        situation: "error",
      };
    }

    return {
      success: false,
      draft: "スプレッドシートの取得中にエラーになりました。しばらくしてからもう一度お試しください。",
      situation: "error",
    };
  }
}
