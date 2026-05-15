import {
  loadLastQueriedSpreadsheet,
  loadUserSpreadsheetDefault,
  saveLastQueriedSpreadsheet,
  saveUserSpreadsheetDefault,
} from "../db/user_sheet_defaults_repo.js";
import {
  clearPendingSpreadsheetConfirm,
  isSpreadsheetConfirmNegative,
  tryConsumePendingSpreadsheetConfirm,
} from "../db/user_sheet_pending_confirm_repo.js";
import {
  clearPendingSheetPick,
  consumePendingSheetPickByIndex,
  peekPendingSheetPick,
  savePendingSheetPick,
  tryConsumePendingSheetPick,
  type SheetPickOption,
} from "../db/user_sheet_pending_pick_repo.js";
import { getEnv } from "../config/env.js";
import {
  extractSpreadsheetIdFromText,
  getServiceAccountClientEmail,
  isValidSpreadsheetId,
  spreadsheetIdFromIntentParams,
} from "../lib/googleSheetsAuth.js";
import { googleUserOAuthEnvConfigured } from "../lib/googleUserOAuthConfig.js";
import { buildSheetReadSuccessHeader, SHEET_READ_SUCCESS_HEADER_REGEX } from "../lib/sheetReplyMarker.js";
import { clipTsv, escapeSheetTitleForA1, resolveSheetTitle, valuesToTsv } from "../lib/sheetFormat.js";
import { setActiveGoogleAccount } from "../db/user_google_oauth_accounts_repo.js";
import { searchSpreadsheetByUserHint } from "../lib/googleDriveSpreadsheetSearch.js";
import { listSheetsAndDriveClientsOrdered, sheetsReadIntegrationEnabled, getSheetsIntegrationDiagnostics } from "../lib/userGoogleSheetsClient.js";
import { listGoogleAccountsForLine } from "../db/user_google_oauth_accounts_repo.js";
import { getLogger } from "../lib/logger.js";
import type { sheets_v4 } from "googleapis";
import type { ModuleContext, ModuleResult } from "./types.js";
import {
  answerSheetQuestionWithLlm,
  inferDriveSheetSearchKeywordsFromLlm,
  pickSheetWithLlm,
  resolvePickIndexWithLlm,
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
    const d = getSheetsIntegrationDiagnostics();
    let serverHint = "";
    if (d.service_account_env_nonempty && !d.service_account_credentials_parse_ok) {
      serverHint =
        "\n\n【サーバー側の状況】`GOOGLE_SERVICE_ACCOUNT_JSON`（または `_B64`）に文字列はありますが、**JSON として読み取れていません**（Base64 欠け・改行混入など）。Render の Environment を開き直してください。";
    } else if (!d.oauth_env_fully_configured && (d.oauth_client_id_set || d.oauth_client_secret_set || d.oauth_redirect_uri_set)) {
      serverHint =
        "\n\n【サーバー側の状況】Google OAuth 用の変数が**一部だけ**です。`GOOGLE_OAUTH_CLIENT_ID` / `CLIENT_SECRET` / `REDIRECT_URI` / `TOKEN_SECRET`（**16文字以上**）の **4つすべて**が必要です。";
    } else if (!d.service_account_env_nonempty && !d.oauth_env_fully_configured) {
      serverHint =
        "\n\n【サーバー側の状況】**OAuth もサービスアカウントも未設定**に見えます。Render を再作成した直後は、以前の Environment がコピーされていないことが多いです。";
    }
    return {
      success: false,
      draft:
        "Googleスプレッドシートを読む機能は、**あなたの Google で連携**（LINE で「Google連携」）または**管理者のサービスアカウント連携**のどちらかが必要です。手順は NEAR の DEPLOY.md「Google スプレッドシート」を参照してください。" +
        serverHint +
        "\n\n（管理者向け）設定の有無だけは `GET /health` の `google_sheets` で確認できます（秘密は含みません）。",
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

  let restoredOriginalQuery: string | null = null;
  if (!spreadsheetId) {
    try {
      // まず正規表現で番号を取れるか試す
      let pickResult = await tryConsumePendingSheetPick(ctx.db, ctx.channelUserId, ctx.originalText);

      // 取れなかった場合は LLM に「何番か」を聞く（「最初のやつ」「一番上」などに対応）
      if (!pickResult) {
        const peek = await peekPendingSheetPick(ctx.db, ctx.channelUserId);
        if (peek && peek.options.length > 0) {
          const llmIdx = await resolvePickIndexWithLlm(ctx.originalText, peek.options);
          if (llmIdx != null) {
            pickResult = await consumePendingSheetPickByIndex(ctx.db, ctx.channelUserId, llmIdx);
            log.info({ llmIdx }, "pending sheet pick resolved via LLM fallback");
          }
        }
      }

      if (pickResult) {
        if (pickResult.spreadsheetId === "SHEETS_CONFIRM_NO") {
          // ユーザーがキャンセルを選択
          log.info({ channelUserId: ctx.channelUserId.slice(0, 12) }, "sheets_query: user cancelled sheet read confirmation");
          return {
            success: true,
            draft: "了解しました。スプレッドシートの読み込みをキャンセルしました。\n\n他にお手伝いできることがあればお知らせください。",
            situation: "success",
          };
        }
        if (pickResult.spreadsheetId === "SHEETS_CONFIRM_YES") {
          // ユーザーが確認済み: originalQuery でシート検索を続行（spreadsheetId は使わない）
          log.info({ channelUserId: ctx.channelUserId.slice(0, 12) }, "sheets_query: user confirmed sheet read — proceeding with original query");
          restoredOriginalQuery = pickResult.originalQuery;
          // spreadsheetId は null のまま → Drive 検索で候補を探す
        } else if (isValidSpreadsheetId(pickResult.spreadsheetId)) {
          spreadsheetId = pickResult.spreadsheetId;
          restoredOriginalQuery = pickResult.originalQuery;
        }
      }
    } catch (e) {
      log.warn({ err: e }, "tryConsumePendingSheetPick failed");
    }
  }

  // 候補選択（番号送信）で元の質問文が復元された場合はそちらを優先して使う
  const effectiveQuery = restoredOriginalQuery ?? ctx.originalText;

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
  if (!spreadsheetId && clientEntries.length === 0 && !env.GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID) {
    log.info(
      { channelUserId: ctx.channelUserId.slice(0, 12) },
      "sheets_query: no spreadsheet id and no sheets/drive clients (OAuth or service account)"
    );

    // アカウント行は存在するがトークン復号失敗の場合（TOKEN_SECRET 変更等）
    const storedAccounts = googleUserOAuthEnvConfigured()
      ? await listGoogleAccountsForLine(ctx.db, ctx.channelUserId).catch(() => [])
      : [];
    if (storedAccounts.length > 0) {
      return {
        success: true,
        draft:
          "以前 Google 連携をしていただきましたが、**トークンが無効**になっています（サーバー再設定などが原因の場合があります）。\n\n" +
          "もう一度「**Google連携**」と送って、ブラウザで再許可してください。\n\n" +
          "状態の詳細は「**Google診断**」で確認できます。",
        situation: "followup",
      };
    }

    return {
      success: true,
      draft:
        "スプレッドシートを読むには **Google 連携**が必要です。\n\n" +
        "「**Google連携**」と送ると、ブラウザで許可するための URL をお送りします。\n" +
        "（あなたの Google で開けるシートをそのまま読めるようになります）",
      situation: "followup",
    };
  }

  // Drive 名前検索は OAuth アカウントのみ（サービスアカウントは自分が共有されたファイルしか見えないため除外）
  const driveSearchableEntries = clientEntries.filter((e) => !e.isServiceAccount);

  // シートIDがまだ無い場合、直近クエリのIDをフォールバックとして使う
  // 「これ見てどう思う？」「さっきのデータ」など前回シートへの言及に対応
  // 直前の NEAR 返答にシート回答（参照マーカー）があるかどうかも確認してから適用
  if (!spreadsheetId) {
    const FOLLOWUP_WORDS_RE =
      /これ|それ|あれ|さっき|先ほど|前の|このデータ|そのデータ|あのデータ|さっきの|先ほどの|前のやつ|もう一度|再度|同じシート|同シート|どう思|所感|感想|コメント|分析|傾向|集計|月別|週別|日別|年別|内訳|詳しく|詳細|まとめ|比較|ランキング|上位|下位|最高|最低|平均|合計|割合|占め|トップ|並べ|ソート|絞り|他は|残り|もっと|さらに|件数|総計|全体|推移|変化|増減|差|割|倍|率|点/u;
    const hadRecentSheetReply = (ctx.recentAssistantMessages ?? []).some((m) =>
      SHEET_READ_SUCCESS_HEADER_REGEX.test(m)
    );
    if (FOLLOWUP_WORDS_RE.test(effectiveQuery) && hadRecentSheetReply) {
      const lastId = await loadLastQueriedSpreadsheet(ctx.db, ctx.channelUserId).catch(() => null);
      if (lastId && isValidSpreadsheetId(lastId)) {
        spreadsheetId = lastId;
        log.info({ spreadsheetId: lastId.slice(0, 8) }, "sheets_query: using last_queried_spreadsheet for followup");
      }
    }
  }

  if (!spreadsheetId && driveSearchableEntries.length > 0) {
    driveSearchAttempted = true;
    const driveLlmKeywords = await inferDriveSheetSearchKeywordsFromLlm(effectiveQuery);
    try {
      for (const entry of driveSearchableEntries) {
        const outcome = await searchSpreadsheetByUserHint(
          entry.clients.drive,
          effectiveQuery,
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
              candidates.map((c) => ({ id: c.id, name: c.name })),
              ctx.originalText  // 元の質問文を保存
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
          // サービスアカウントのスコープ不足は OAuth 再連携では解決できないためフラグを立てない
          if (!entry.isServiceAccount) {
            driveSearchInsufficientScope = true;
          }
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
        "Drive でのファイル名検索ができない状態です。\n\n" +
        "**考えられる原因と対処：**\n\n" +
        "① **Google Drive API が未有効** の場合\n" +
        "　GCP の「APIとサービス」→「ライブラリ」で `Google Drive API` を検索して有効化\n\n" +
        "② **Drive スコープが未許可** の場合\n" +
        "　LINE で「**Google連携**」→ URL を開く → Drive・スプレッドシート・カレンダーにチェックして再許可\n\n" +
        "今回はスプレッドシートの **URL** を貼ってもらえれば読み取りできます。";
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

    const pickedRaw = await pickSheetWithLlm(effectiveQuery, titles);
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
      effectiveQuery + (bookTitle ? `\n（ブック名の参考: ${bookTitle}）` : ""),
      sheetTitle,
      tsv
    );

    // 成功時に最後に使ったシートIDを記録（「URLリンク出して」に答えるため）
    saveLastQueriedSpreadsheet(ctx.db, ctx.channelUserId, spreadsheetId).catch((e) =>
      log.warn({ err: e }, "saveLastQueriedSpreadsheet failed")
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
