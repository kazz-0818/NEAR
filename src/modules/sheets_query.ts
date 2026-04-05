import OpenAI from "openai";
import type { Db } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { extractSpreadsheetIdFromText, getServiceAccountClientEmail } from "../lib/googleSheetsAuth.js";
import { googleUserOAuthEnvConfigured } from "../lib/googleUserOAuthConfig.js";
import { getSheetsForLineUser, sheetsReadIntegrationEnabled } from "../lib/userGoogleSheetsClient.js";
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
          "あなたはスプレッドシートのシート名選択器です。ユーザーの質問に答えるのに最も適切な1つのシート名を、次の一覧から選びます。\n" +
          "ユーザーは「購入代行シート」「POPUP」「3月の売上は？」のように**ざっくり言う**ことがあります。**会話に出た名前・業務名に最も近いタブ名**を選び、一覧に完全一致する文字列を sheetTitle に入れてください（「シート」接尾辞だけ違う場合は一致する本体名を選ぶ）。",
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
          "あなたはAI秘書「NEAR」です。与えられた表データ（タブ区切り・1行目が見出しのことが多い）**だけ**を根拠に答えてください。\n\n" +
          "**最優先: ユーザーの指示に合わせて提示する（臨機応変）**\n" +
          "- 質問に**形式・長さ・切り口**の希望があれば、それに最優先で従う（例: 「一覧だけ」「箇条書き」「結論だけ」「詳しく」「報告書調」「短文で」「表っぽく」「ワンポイント」「比較して」「ランキング」「日別に」など）。\n" +
          "- 指定が無いときは読みやすさ優先。集計・件数が主目的なら、見出し＋・行の一覧でもよいが、**決まったテンプレに縛らない**。\n" +
          "- ユーザーが**締め・所感・雑談を不要**と言っていれば付けない。必要なら最後に**短い1文** NEAR らしく（従順＋軽口）。サービス定型の長いお礼は使わない。\n\n" +
          "**内容:** 丸写しや列の機械羅列**だけ**で終わらせない。依頼に応じて (1)集計・算出 (2)条件・期間での抽出 (3)比較・傾向・所感 を必要な分だけ含める。「一覧だけ」と明示されていても、最低限の見出しや区切りで読みやすくしてよい。見出し行から列を推定し、日付表記のゆれに注意。データに無いことは書かない。\n\n" +
          "日本語で。数値・結論は落とさない。",
      },
      {
        role: "user",
        content: `シート名: ${sheetTitle}\n\n質問:\n${userQuestion}\n\n表データ:\n${tsv}`,
      },
    ],
    max_tokens: 1200,
    temperature: 0.35,
  });
  return completion.choices[0]?.message?.content?.trim() ?? "すみません、回答を組み立てられませんでした。";
}

export async function sheetsQuery(ctx: ModuleContext): Promise<ModuleResult> {
  const log = getLogger();
  const env = getEnv();

  if (!sheetsReadIntegrationEnabled()) {
    return {
      success: false,
      draft:
        "Googleスプレッドシートを読む機能は、**あなたの Google で連携**（LINE で「Google連携」）または**管理者のサービスアカウント連携**のどちらかが必要です。手順は NEAR の DEPLOY.md「Google スプレッドシート」を参照してください。",
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
    const sheets = await getSheetsForLineUser(ctx.db, ctx.channelUserId);
    if (!sheets) {
      return {
        success: true,
        draft:
          "スプレッドシート用の認証がありません。\n" +
          "・トークで「**Google連携**」と送ると、ブラウザで許可する URL を出します（あなたの Google で見えるシートを読みます）。\n" +
          "・または管理者にサービスアカウント連携とシート共有を依頼してください（DEPLOY.md）。",
        situation: "followup",
      };
    }
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
      let shareHint = email
        ? `スプレッドシートの「共有」で、次のサービスアカウントに**閲覧者**以上を追加してください:\n${email}`
        : "スプレッドシートを、NEAR 用サービスアカウントに共有してください（閲覧者以上）。";
      if (googleUserOAuthEnvConfigured()) {
        shareHint +=
          "\n\n※ **Google 連携**で読んでいる場合は、その Google アカウントから当該シートを開けるか確認してください。別アカウントのシートなら共有が必要です。未連携なら「Google連携」から許可してください。";
      }
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
