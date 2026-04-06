import { randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import {
  listGoogleAccountsForLine,
  setActiveGoogleAccount,
} from "../db/user_google_oauth_accounts_repo.js";
import { getEffectivePublicBaseUrl } from "../lib/renderRuntime.js";
import { googleUserOAuthEnvConfigured } from "../lib/googleUserOAuthConfig.js";

function accountLabel(a: { email: string | null; googleSub: string }): string {
  const mail = a.email?.trim();
  if (mail) return mail;
  if (a.googleSub.startsWith("legacy:")) return "（以前の連携・メール未取得。再連携で表示されます）";
  return "（メール未取得）";
}

/** LINE で「Google連携」等と送られたとき、ブラウザ用ワンタイム URL を返す */
export async function tryHandleGoogleOAuthUserLine(input: {
  db: Db;
  text: string;
  channelUserId: string;
}): Promise<{ handled: boolean; reply?: string }> {
  const t = input.text.normalize("NFKC").trim();
  // 「Google連携一覧」などと誤爆しないよう、連携依頼の短文に限定
  if (
    !/^[\s　]*(google|グーグル|ｇｏｏｇｌｅ)\s*連携[\s　]*(して|お願いします?|ください)?[\s　。!！]*$/iu.test(t)
  ) {
    return { handled: false };
  }

  if (!googleUserOAuthEnvConfigured()) {
    return {
      handled: true,
      reply:
        "Google のユーザー連携は、いまのサーバーでは未設定です。管理者に `GOOGLE_OAUTH_CLIENT_ID` / `CLIENT_SECRET` / `REDIRECT_URI` / `GOOGLE_OAUTH_TOKEN_SECRET` の設定を依頼してください。",
    };
  }

  const base = getEffectivePublicBaseUrl();
  if (!base) {
    return {
      handled: true,
      reply:
        "連携用の公開 URL が分かりません。`PUBLIC_BASE_URL`（または Render の `RENDER_EXTERNAL_URL`）を管理者に設定してもらってから、もう一度「Google連携」と送ってください。",
    };
  }

  const token = randomBytes(32).toString("base64url");
  await input.db.query(
    `INSERT INTO google_oauth_link_tokens (token, line_user_id, expires_at)
     VALUES ($1, $2, now() + interval '15 minutes')`,
    [token, input.channelUserId]
  );

  const url = `${base}/oauth/google/start?link=${encodeURIComponent(token)}`;
  const existing = await listGoogleAccountsForLine(input.db, input.channelUserId);
  const extra =
    existing.length > 0
      ? [
          "",
          "**2つ目以降の Google** も同じ手順で追加できます（ブラウザで別アカウントを選べば、上書きされず並びます）。",
          "シートを読むときは、NEAR が**連携済みのアカウントを順に自動で試し**、開けた方で進めます（手動の切り替えは基本不要です）。",
          "確認したいときだけ「**Googleアカウント一覧**」、特定のアカウントに固定したいときだけ「**Google 1**」などでも切り替えできます。",
        ].join("\n")
      : "";

  return {
    handled: true,
    reply: [
      "Google アカウントの権限でシートを読む連携ですね。",
      "",
      `次の URL を**15分以内**にブラウザで開き、許可してください:`,
      url,
      "",
      "完了後、あなたの Google で開けるスプレッドシートは、サービスアカウントへの共有なしで読み取れます（閲覧できる範囲のみ）。",
      "スプレッドシートは **URL 無しでも**、Drive の**ファイル名**から探せる場合があります。",
      extra,
    ].join("\n"),
  };
}

/**
 * 「Googleアカウント一覧」「Google 2」など、複数連携の確認・切り替え。
 */
export async function tryHandleGoogleAccountListOrSwitch(input: {
  db: Db;
  text: string;
  channelUserId: string;
}): Promise<{ handled: boolean; reply?: string }> {
  if (!googleUserOAuthEnvConfigured()) return { handled: false };

  const t = input.text.normalize("NFKC").trim();

  const listMatch =
    /^(google|グーグル|ｇｏｏｇｌｅ)\s*(アカウント)?\s*(一覧|確認|なに|表示|教えて)\s*$/iu.test(t) ||
    /^(google|グーグル|ｇｏｏｇｌｅ)\s*連携\s*一覧\s*$/iu.test(t) ||
    /^(連携|れんけい).{0,8}(した)?(google|グーグル).{0,10}(一覧|確認|なに)/iu.test(t) ||
    /^google\s*accounts?\s*$/iu.test(t);

  const switchMatch =
    t.match(/^(?:google|グーグル|ｇｏｏｇｌｅ)\s*は?\s*(\d{1,2})\s*(?:番)?\s*$/iu) ??
    t.match(/^(\d{1,2})\s*番の?\s*(?:google|グーグル|ｇｏｏｇｌｅ)\s*$/iu);

  if (!listMatch && !switchMatch) return { handled: false };

  const accounts = await listGoogleAccountsForLine(input.db, input.channelUserId);
  if (accounts.length === 0) {
    return {
      handled: true,
      reply: "まだ Google 連携がありません。まず「**Google連携**」と送って、ブラウザから許可してください。",
    };
  }

  if (switchMatch) {
    const n = parseInt(switchMatch[1] ?? "", 10);
    if (!Number.isFinite(n) || n < 1 || n > accounts.length) {
      return {
        handled: true,
        reply: `番号は **1〜${accounts.length}** で指定してください。\n「**Googleアカウント一覧**」で並びを確認できます。`,
      };
    }
    const picked = accounts[n - 1];
    await setActiveGoogleAccount(input.db, input.channelUserId, picked.googleSub);
    return {
      handled: true,
      reply: [
        `Google の**利用アカウント**を切り替えました（${n}番）。`,
        `・${accountLabel(picked)}`,
        "",
        "このアカウントで開けるスプレッドシートを、Drive 検索・読み取りの対象にします。",
      ].join("\n"),
    };
  }

  const lines = accounts.map((a, i) => {
    const mark = a.isActive ? "★ " : "　 ";
    return `${mark}${i + 1}. ${accountLabel(a)}`;
  });
  return {
    handled: true,
    reply: [
      "連携済みの Google アカウントです（★ がいま使うアカウント）。",
      "",
      ...lines,
      "",
      "特定アカウントに固定: 「**Google 2**」「**2番のGoogle**」など。",
      "追加: もう一度「**Google連携**」→ URL を開き、ブラウザで**別の Google** を選んで許可してください。",
    ].join("\n"),
  };
}
