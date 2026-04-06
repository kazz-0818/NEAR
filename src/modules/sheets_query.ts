import { loadUserSpreadsheetDefault, saveUserSpreadsheetDefault } from "../db/user_sheet_defaults_repo.js";
import {
  clearPendingSpreadsheetConfirm,
  isSpreadsheetConfirmNegative,
  savePendingSpreadsheetConfirm,
  tryConsumePendingSpreadsheetConfirm,
} from "../db/user_sheet_pending_confirm_repo.js";
import { getEnv } from "../config/env.js";
import {
  extractSpreadsheetIdFromText,
  getServiceAccountClientEmail,
  isValidSpreadsheetId,
  spreadsheetIdFromIntentParams,
} from "../lib/googleSheetsAuth.js";
import { googleUserOAuthEnvConfigured } from "../lib/googleUserOAuthConfig.js";
import { buildSheetReadSuccessHeader } from "../lib/sheetReplyMarker.js";
import { clipTsv, escapeSheetTitleForA1, resolveSheetTitle, valuesToTsv } from "../lib/sheetFormat.js";
import { searchSpreadsheetByUserHint } from "../lib/googleDriveSpreadsheetSearch.js";
import { getSheetsAndDriveForLineUser, sheetsReadIntegrationEnabled } from "../lib/userGoogleSheetsClient.js";
import { getLogger } from "../lib/logger.js";
import type { ModuleContext, ModuleResult } from "./types.js";
import { answerSheetQuestionWithLlm, pickSheetWithLlm } from "./sheets_query_llm.js";

const SET_DEFAULT_RE =
  /(常用|既定|デフォルト|いつも|デフォ).{0,20}(スプレッド|シート)|(スプレッド|シート).{0,12}(常用|既定|デフォルト|いつも)/i;

export { loadUserSpreadsheetDefault } from "../db/user_sheet_defaults_repo.js";

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

  if (isSpreadsheetConfirmNegative(ctx.originalText)) {
    try {
      await clearPendingSpreadsheetConfirm(ctx.db, ctx.channelUserId);
    } catch (e) {
      log.warn({ err: e }, "clearPendingSpreadsheetConfirm failed");
    }
  }

  const idFromMessage = extractSpreadsheetIdFromText(ctx.originalText);
  if (idFromMessage && SET_DEFAULT_RE.test(ctx.originalText)) {
    try {
      await saveUserSpreadsheetDefault(ctx.db, ctx.channelUserId, idFromMessage);
      return {
        success: true,
        draft: `このスプレッドシートを、あなたの**既定**に保存しました。\n次から URL を省略して「POPUPシートの売上は？」のように聞いても試せます（他に既定が無い場合）。`,
        situation: "success",
      };
    } catch (e) {
      log.warn({ err: e }, "saveUserSpreadsheetDefault failed");
    }
  }

  let spreadsheetId =
    spreadsheetIdFromIntentParams(ctx.intent.required_params) ??
    idFromMessage ??
    (await loadUserSpreadsheetDefault(ctx.db, ctx.channelUserId)) ??
    env.GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID?.trim() ??
    null;

  if (!spreadsheetId) {
    try {
      const affirmed = await tryConsumePendingSpreadsheetConfirm(ctx.db, ctx.channelUserId, ctx.originalText);
      if (affirmed && isValidSpreadsheetId(affirmed)) spreadsheetId = affirmed;
    } catch (e) {
      log.warn({ err: e }, "tryConsumePendingSpreadsheetConfirm failed");
    }
  }

  let clients: Awaited<ReturnType<typeof getSheetsAndDriveForLineUser>> = null;
  try {
    clients = await getSheetsAndDriveForLineUser(ctx.db, ctx.channelUserId);
  } catch (e) {
    log.warn({ err: e }, "getSheetsAndDriveForLineUser failed");
    clients = null;
  }

  let driveSearchInsufficientScope = false;

  if (!spreadsheetId && clients) {
    try {
      const outcome = await searchSpreadsheetByUserHint(clients.drive, ctx.originalText);
      if (outcome.kind === "one") {
        spreadsheetId = outcome.id;
        log.info({ bookName: outcome.name }, "sheets drive search resolved spreadsheet");
      } else if (outcome.kind === "confirm") {
        const { suggested, alternatives } = outcome;
        let draft =
          "あなたの言い方はざっくりでも大丈夫です。Drive 上で似た名前のシートが複数あったので、まずは次を**第一候補**にしています。\n\n" +
          `**「${suggested.name}」**\n\n` +
          "**これでよろしかったですか？**\n" +
          "・**合っていれば**「はい」「それで」「OK」など一言送ってください（この候補で読みにいきます）。\n" +
          "・**違う場合**は、正しい**ファイル名をそのまま**送るか、**共有リンク**を送ってください。\n";
        if (alternatives.length > 0) {
          draft += "\n**他の候補（参考）**\n" + alternatives.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
        }
        try {
          await savePendingSpreadsheetConfirm(ctx.db, ctx.channelUserId, suggested.id, suggested.name);
        } catch (e) {
          log.warn({ err: e }, "savePendingSpreadsheetConfirm failed");
        }
        return {
          success: true,
          draft,
          situation: "followup",
        };
      } else if (outcome.kind === "insufficient_scope") {
        driveSearchInsufficientScope = true;
      }
    } catch (e) {
      log.warn({ err: e }, "searchSpreadsheetByUserHint failed");
    }
  }

  if (!spreadsheetId) {
    let draft =
      "どのスプレッドシートを見るか決められませんでした。\n" +
      "・あなたの Google ドライブ上の**ファイル名**にキーワード（例:【購入代行】）が入っていれば、**リンク無しでも自動で探す**ことがあります。\n" +
      "・見つからないときは共有リンク（`https://docs.google.com/spreadsheets/d/...`）を送るか、\n" +
      "・管理者が `GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID` を設定しているか、\n" +
      "・一度「このシートを既定にして」とリンク付きで言って保存してください。";
    if (driveSearchInsufficientScope && googleUserOAuthEnvConfigured()) {
      draft +=
        "\n\n※ **名前からの自動検索**には、Google 連携に **Drive（ファイル名の参照）** の許可が必要です。LINE で「**Google連携**」から、もう一度ブラウザで許可し直してください。";
    }
    return {
      success: true,
      draft,
      situation: "followup",
    };
  }

  const maxRows = env.GOOGLE_SHEETS_MAX_ROWS;

  try {
    if (!clients) {
      return {
        success: true,
        draft:
          "スプレッドシート用の認証がありません。\n" +
          "・トークで「**Google連携**」と送ると、ブラウザで許可する URL を出します（あなたの Google で見えるシートを読みます）。\n" +
          "・または管理者にサービスアカウント連携とシート共有を依頼してください（DEPLOY.md）。",
        situation: "followup",
      };
    }
    const sheets = clients.sheets;
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
    const answer = await answerSheetQuestionWithLlm(
      ctx.originalText + (bookTitle ? `\n（ブック名の参考: ${bookTitle}）` : ""),
      sheetTitle,
      tsv
    );

    const header = buildSheetReadSuccessHeader(sheetTitle, lastRow, spreadsheetId);
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
