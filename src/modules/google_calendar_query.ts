import { getLogger } from "../lib/logger.js";
import { googleUserOAuthEnvConfigured } from "../lib/googleUserOAuthConfig.js";
import { getCalendarClientForLineUser, scopeIncludesCalendar } from "../lib/userGoogleCalendarClient.js";
import { resolveRefreshTokenForSheets } from "../db/user_google_oauth_accounts_repo.js";
import type { ModuleContext, ModuleResult } from "./types.js";

const TZ = "Asia/Tokyo";

/** 追加依頼っぽい（一覧より優先しない。追加パースに回す） */
const ADD_INTENT = /予定(を)?追加|カレンダーに(追加|登録)|イベント(を)?追加|スケジュール(を)?追加/i;

const ISO_FULL =
  /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+\-]\d{2}:\d{2}|[+\-]\d{4}))\b/;

export type ParsedCalendarAdd = {
  summary: string;
  startIso: string;
  endIso: string;
};

/**
 * 追加の軽いパース:
 * - 1行目 `予定追加` / `カレンダーに追加` のあと、タイトルと ISO 時刻（1行または `タイトル | ISO`）
 * - または本文中の最初の ISO8601 をタイトルとセットで解釈
 */
export function tryParseCalendarAdd(text: string): ParsedCalendarAdd | null {
  const raw = text.normalize("NFKC").trim();
  if (!ADD_INTENT.test(raw) && !/^[\s　]*(予定追加|カレンダー追加)/i.test(raw)) {
    return null;
  }

  const pipe = raw.split("|").map((s) => s.trim());
  if (pipe.length >= 2) {
    const title = pipe[0].replace(/^(予定追加|カレンダーに追加|カレンダー追加)[:：]?\s*/i, "").trim();
    const rest = pipe.slice(1).join("|").trim();
    const m = rest.match(ISO_FULL);
    if (title.length > 0 && m) {
      const start = new Date(m[1]);
      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        return { summary: title.slice(0, 500), startIso: start.toISOString(), endIso: end.toISOString() };
      }
    }
  }

  const isoMatch = raw.match(ISO_FULL);
  if (isoMatch) {
    const start = new Date(isoMatch[1]);
    if (!Number.isNaN(start.getTime())) {
      let summary = raw
        .replace(ISO_FULL, "")
        .replace(/^(予定追加|カレンダーに追加|カレンダー追加|予定を追加)[:：]?\s*/i, "")
        .replace(/[\s　]+/g, " ")
        .trim();
      summary = summary.replace(/^[\|｜\s]+/, "").trim();
      if (summary.length < 1) summary = "（タイトルなし）";
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      return {
        summary: summary.slice(0, 500),
        startIso: start.toISOString(),
        endIso: end.toISOString(),
      };
    }
  }

  return null;
}

function formatEventList(
  items: Array<{ summary?: string | null; start?: { dateTime?: string | null; date?: string | null }; end?: { dateTime?: string | null; date?: string | null } }>
): string {
  if (items.length === 0) return "（表示期間に予定はありませんでした）";
  const lines = items.slice(0, 20).map((ev) => {
    const sum = ev.summary ?? "（無題）";
    const start = ev.start?.dateTime ?? ev.start?.date ?? "?";
    const end = ev.end?.dateTime ?? ev.end?.date ?? "";
    return `・${sum}\n  ${start}${end ? ` 〜 ${end}` : ""}`;
  });
  return lines.join("\n\n");
}

export async function googleCalendarQuery(ctx: ModuleContext): Promise<ModuleResult> {
  const log = getLogger();

  if (!googleUserOAuthEnvConfigured()) {
    return {
      success: false,
      draft:
        "Google カレンダー連携には、サーバー側の Google OAuth 設定が必要です。管理者に `GOOGLE_OAUTH_*` の設定を依頼してください。",
      situation: "unsupported",
    };
  }

  const calCtx = await getCalendarClientForLineUser(ctx.db, ctx.channelUserId);
  if (!calCtx) {
    const resolved = await resolveRefreshTokenForSheets(ctx.db, ctx.channelUserId);
    const r = resolved
      ? await ctx.db.query<{ scope: string | null }>(
          `SELECT scope FROM user_google_oauth_accounts WHERE line_user_id = $1 AND google_sub = $2`,
          [ctx.channelUserId, resolved.googleSub]
        )
      : { rows: [] as { scope: string | null }[] };
    const scope = r.rows[0]?.scope ?? null;

    if (resolved && !scopeIncludesCalendar(scope)) {
      return {
        success: true,
        draft:
          "Google は連携済みですが、**カレンダー権限がまだ**です。\n" +
          "LINE で「**Google連携**」と送り、ブラウザで**もう一度許可**してください（カレンダー用の権限を追加しました）。\n" +
          "完了後、もう一度お試しください。",
        situation: "followup",
      };
    }

    return {
      success: true,
      draft:
        "Google カレンダーを操作するには、先に **Google 連携**が必要です。\n" +
        "LINE で「**Google連携**」と送ると、ブラウザで許可する URL が出ます。\n" +
        "（スプレッドシート用と同じ連携で、カレンダー予定の一覧・追加も行えます。）",
      situation: "followup",
    };
  }

  const { calendar } = calCtx;

  const add = tryParseCalendarAdd(ctx.originalText);
  if (add) {
    try {
      await calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary: add.summary,
          start: { dateTime: add.startIso, timeZone: TZ },
          end: { dateTime: add.endIso, timeZone: TZ },
        },
      });
      return {
        success: true,
        draft:
          `カレンダー（primary）に予定を追加しました。\n\n**${add.summary}**\n開始: ${add.startIso}\n\n※ 他のカレンダーや繰り返しは、今後の拡張で対応できます。`,
        situation: "success",
      };
    } catch (e) {
      log.warn({ err: e }, "calendar events.insert failed");
      const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "error";
      if (/403|Insufficient Permission|insufficient authentication scopes/i.test(msg)) {
        return {
          success: true,
          draft:
            "カレンダーへの書き込みが許可されていません。LINE で「**Google連携**」から**再許可**（カレンダー権限）をお願いします。",
          situation: "followup",
        };
      }
      return {
        success: false,
        draft: "カレンダーへの追加でエラーになりました。時間をおいて再度お試しください。",
        situation: "error",
      };
    }
  }

  if (ADD_INTENT.test(ctx.originalText) && !add) {
    return {
      success: true,
      draft:
        "予定を追加するには、次のどちらかの形式で送ってください。\n\n" +
        "**形式A（おすすめ）**\n" +
        "`予定追加: 打ち合わせ | 2026-04-10T15:00:00+09:00`\n\n" +
        "**形式B**\n" +
        "1行目: `予定追加`\n" +
        "2行目: タイトル\n" +
        "3行目: `2026-04-10T15:00:00+09:00`（ISO8601）\n\n" +
        "終了時刻は省略時、開始から1時間後として登録します。",
      situation: "followup",
    };
  }

  try {
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: in7d.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 25,
    });
    const items = res.data.items ?? [];
    const body = formatEventList(items);
    const intro = /同期|連携|つなが/i.test(ctx.originalText)
      ? "Google カレンダーと連携するには、LINE で「**Google連携**」で許可してください（未連携の場合）。連携後は **primary カレンダー**の予定を表示・追加できます。\n\n"
      : "";
    return {
      success: true,
      draft:
        `${intro}` +
        `**Google カレンダー（primary・今から7日間）**の予定です。\n\n${body}\n\n` +
        `※ 追加: 「予定追加: タイトル | 2026-04-10T15:00:00+09:00」`,
      situation: "success",
    };
  } catch (e) {
    log.warn({ err: e }, "calendar events.list failed");
    const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "error";
    if (/403|Insufficient Permission|insufficient authentication scopes/i.test(msg)) {
      return {
        success: true,
        draft:
          "カレンダーを読み取れませんでした。LINE で「**Google連携**」から**再許可**し、カレンダーへのアクセスを許可してください。",
        situation: "followup",
      };
    }
    return {
      success: false,
      draft: "カレンダーの取得でエラーになりました。しばらくしてから再度お試しください。",
      situation: "error",
    };
  }
}
