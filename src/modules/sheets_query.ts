import { loadUserSpreadsheetDefault, saveUserSpreadsheetDefault } from "../db/user_sheet_defaults_repo.js";
import {
  clearPendingSpreadsheetConfirm,
  isSpreadsheetConfirmNegative,
  tryConsumePendingSpreadsheetConfirm,
} from "../db/user_sheet_pending_confirm_repo.js";
import {
  clearPendingSheetPick,
  savePendingSheetPick,
  tryConsumePendingSheetPick,
} from "../db/user_sheet_pending_pick_repo.js";
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
import { setActiveGoogleAccount } from "../db/user_google_oauth_accounts_repo.js";
import { searchSpreadsheetByUserHint } from "../lib/googleDriveSpreadsheetSearch.js";
import { listSheetsAndDriveClientsOrdered, sheetsReadIntegrationEnabled } from "../lib/userGoogleSheetsClient.js";
import { getLogger } from "../lib/logger.js";
import type { sheets_v4 } from "googleapis";
import type { ModuleContext, ModuleResult } from "./types.js";
import {
  answerSheetQuestionWithLlm,
  inferDriveSheetSearchKeywordsFromLlm,
  pickSheetWithLlm,
} from "./sheets_query_llm.js";

const SET_DEFAULT_RE =
  /(常用|既定|デフォルト|いつも|デフォ).{0,20}(スプレッド|シート)|(スプレッド|シート).{0,12}(常用|既定|デフォルト|いつも)/i;

function isSwitchToNextGoogleAccountError(e: unknown): boolean {
  const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : String(e);
  return (
    /PERMISSION_DENIED|403/i.test(msg) ||
    /The caller does not have permission/i.test(msg) ||
    /not found|NOT_FOUND|404/i.test(msg)
  );
}

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
      await clearPendingSheetPick(ctx.db, ctx.channelUserId);
    } catch (e) {
      log.warn({ err: e }, "clear pending sheet state failed");
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
      const pickedId = await tryConsumePendingSheetPick(ctx.db, ctx.channelUserId, ctx.originalText);
      if (pickedId && isValidSpreadsheetId(pickedId)) spreadsheetId = pickedId;
    } catch (e) {
      log.warn({ err: e }, "tryConsumePendingSheetPick failed");
    }
  }

  if (!spreadsheetId) {
    try {
      const affirmed = await tryConsumePendingSpreadsheetConfirm(ctx.db, ctx.channelUserId, ctx.originalText);
      if (affirmed && isValidSpreadsheetId(affirmed)) spreadsheetId = affirmed;
    } catch (e) {
      log.warn({ err: e }, "tryConsumePendingSpreadsheetConfirm failed");
    }
  }

  let clientEntries: Awaited<ReturnType<typeof listSheetsAndDriveClientsOrdered>> = [];
  try {
    clientEntries = await listSheetsAndDriveClientsOrdered(ctx.db, ctx.channelUserId);
  } catch (e) {
    log.warn({ err: e }, "listSheetsAndDriveClientsOrdered failed");
    clientEntries = [];
  }

  let driveSearchInsufficientScope = false;
  let driveSearchAttempted = false;

  /** spreadsheetId が無く、Google クライアントも無い → Drive 検索も呼べない（先に返す） */
  if (!spreadsheetId && clientEntries.length === 0) {
    log.info(
      { channelUserId: ctx.channelUserId.slice(0, 12) },
      "sheets_query: no spreadsheet id and no sheets/drive clients (OAuth or service account)"
    );
    return {
      success: true,
      draft:
        "スプレッドシート用の認証がありません。\n" +
        "・トークで「**Google連携**」と送ると、ブラウザで許可する URL を出します（あなたの Google で見えるシートを読みます）。\n" +
        "・または管理者にサービスアカウント連携とシート共有を依頼してください（DEPLOY.md）。",
      situation: "followup",
    };
  }

  if (!spreadsheetId && clientEntries.length > 0) {
    driveSearchAttempted = true;
    const driveLlmKeywords = await inferDriveSheetSearchKeywordsFromLlm(ctx.originalText);
    try {
      for (const entry of clientEntries) {
        const outcome = await searchSpreadsheetByUserHint(
          entry.clients.drive,
          ctx.originalText,
          driveLlmKeywords
        );
        if (outcome.kind === "one") {
          spreadsheetId = outcome.id;
          if (!entry.isServiceAccount) {
            await setActiveGoogleAccount(ctx.db, ctx.channelUserId, entry.googleSub);
          }
          log.info(
            { bookName: outcome.name, googleSub: entry.googleSub.slice(0, 12) },
            "sheets drive search resolved spreadsheet"
          );
          break;
        }
        if (outcome.kind === "pick_list") {
          const { candidates } = outcome;
          if (candidates.length === 0) continue;
          if (!entry.isServiceAccount) {
            await setActiveGoogleAccount(ctx.db, ctx.channelUserId, entry.googleSub);
          }
          try {
            await clearPendingSpreadsheetConfirm(ctx.db, ctx.channelUserId);
            await savePendingSheetPick(
              ctx.db,
              ctx.channelUserId,
              candidates.map((c) => ({ id: c.id, name: c.name }))
            );
          } catch (e) {
            log.warn({ err: e }, "savePendingSheetPick failed");
          }
          const lines = candidates.map((c, i) => `${i + 1}. ${c.name}`);
          const draft =
            "Drive でいくつか候補が見つかりました。どれですか？\n\n" +
            lines.join("\n") +
            "\n\n番号だけ送ってください（例: `1`）。";
          return {
            success: true,
            draft,
            situation: "followup",
          };
        }
        if (outcome.kind === "insufficient_scope") {
          driveSearchInsufficientScope = true;
        }
      }
    } catch (e) {
      log.warn({ err: e }, "searchSpreadsheetByUserHint failed");
    }
  }

  if (!spreadsheetId) {
    let draft: string;
    if (driveSearchInsufficientScope && googleUserOAuthEnvConfigured()) {
      draft =
        "Drive の参照権限が不足しているため、ファイル名検索が使えない状態です。\n" +
        "「**Google連携**」と送って再許可してもらえると、次回からリンクなしで探せます。\n\n" +
        "今回はスプレッドシートのリンクを貼ってもらえますか？";
    } else if (driveSearchAttempted) {
      draft =
        "Drive でファイル名を検索しましたが、ぴったりのスプレッドシートが見つかりませんでした。\n\n" +
        "もう少し具体的なファイル名か、スプレッドシートのリンク（`https://docs.google.com/spreadsheets/d/...`）を送ってください。\n" +
        "「このシートを既定にして」で保存しておくと、次回から省略できます。";
    } else {
      draft =
        "スプレッドシートを特定できませんでした。\n\n" +
        "ファイル名か、スプレッドシートのリンク（`https://docs.google.com/spreadsheets/d/...`）を送ってください。";
    }
    return {
      success: true,
      draft,
      situation: "followup",
    };
  }

  const maxRows = env.GOOGLE_SHEETS_MAX_ROWS;

  try {
    if (clientEntries.length === 0) {
      log.warn(
        { channelUserId: ctx.channelUserId.slice(0, 12), spreadsheetId: spreadsheetId.slice(0, 8) },
        "sheets_query: have spreadsheetId but no clients (unexpected)"
      );
      return {
        success: true,
        draft:
          "スプレッドシート用の認証がありません。\n" +
          "・トークで「**Google連携**」と送ると、ブラウザで許可する URL を出します（あなたの Google で見えるシートを読みます）。\n" +
          "・または管理者にサービスアカウント連携とシート共有を依頼してください（DEPLOY.md）。",
        situation: "followup",
      };
    }

    let sheets: sheets_v4.Sheets | null = null;
    let meta: { data: sheets_v4.Schema$Spreadsheet } | null = null;
    let lastTryErr: unknown = null;

    for (const entry of clientEntries) {
      try {
        const m = await entry.clients.sheets.spreadsheets.get({ spreadsheetId });
        meta = m;
        sheets = entry.clients.sheets;
        if (!entry.isServiceAccount) {
          await setActiveGoogleAccount(ctx.db, ctx.channelUserId, entry.googleSub);
        }
        log.info({ googleSub: entry.googleSub.slice(0, 12) }, "sheets read using google account");
        break;
      } catch (e) {
        lastTryErr = e;
        if (isSwitchToNextGoogleAccountError(e)) {
          log.info({ err: e, googleSub: entry.googleSub.slice(0, 12) }, "sheets get: try next linked account");
          continue;
        }
        throw e;
      }
    }

    if (!meta || !sheets) {
      throw lastTryErr ?? new Error("no sheets client could open spreadsheet");
    }

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
