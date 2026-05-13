import { randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import {
  listGoogleAccountsForLine,
  listGoogleOAuthTokenPairsOrdered,
  setActiveGoogleAccount,
} from "../db/user_google_oauth_accounts_repo.js";
import { getEffectivePublicBaseUrl } from "../lib/renderRuntime.js";
import { googleUserOAuthEnvConfigured } from "../lib/googleUserOAuthConfig.js";
import { googleSheetsConfigured } from "../lib/googleSheetsAuth.js";

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
    `INSERT INTO near_google_oauth_link_tokens (token, line_user_id, expires_at)
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
      "Google アカウントの権限で、**スプレッドシート**と**カレンダー（予定の一覧・追加）**にアクセスする連携ですね。",
      "",
      `次の URL を**15分以内**にブラウザで開き、許可してください:`,
      url,
      "",
      "完了後、あなたの Google で開けるスプレッドシートは、サービスアカウントへの共有なしで読み取れます（閲覧できる範囲のみ）。カレンダーも同じ連携で利用できます。",
      "スプレッドシートは **URL 無しでも**、Drive の**ファイル名**から探せる場合があります。",
      extra,
    ].join("\n"),
  };
}

/**
 * 「Google診断」「Google状態」コマンド: 連携状態の詳細を返す（開発者・デバッグ向け）。
 */
export async function tryHandleGoogleDiagnostic(input: {
  db: Db;
  text: string;
  channelUserId: string;
}): Promise<{ handled: boolean; reply?: string }> {
  const t = input.text.normalize("NFKC").trim();
  if (!/^(google|グーグル|ｇｏｏｇｌｅ)?\s*(診断|状態確認|状態|つながってる|つながってる？|接続確認)$/iu.test(t)) {
    return { handled: false };
  }

  const lines: string[] = ["**Google 連携の診断結果**", ""];

  // OAuth 環境変数
  const oauthEnvOk = googleUserOAuthEnvConfigured();
  lines.push(`OAuth 環境変数: ${oauthEnvOk ? "✓ 設定済み" : "✗ 未設定（GOOGLE_OAUTH_CLIENT_ID 等が必要）"}`);

  // サービスアカウント
  const saOk = googleSheetsConfigured();
  lines.push(`サービスアカウント: ${saOk ? "✓ 設定済み" : "✗ 未設定"}`);

  // 連携アカウント
  const REQUIRED_SCOPES = ["drive.metadata.readonly", "spreadsheets.readonly", "calendar.events"] as const;
  const requiredScopePatterns = REQUIRED_SCOPES.map((s) => new RegExp(s.replace(".", "\\."), "i"));

  if (oauthEnvOk) {
    const accounts = await listGoogleAccountsForLine(input.db, input.channelUserId);
    lines.push(`\n連携アカウント数: ${accounts.length} 件`);
    if (accounts.length > 0) {
      const pairs = await listGoogleOAuthTokenPairsOrdered(input.db, input.channelUserId);
      const validSubs = new Set(pairs.map((p) => p.googleSub));

      // scope 情報を DB から取得
      const scopeMap = new Map<string, string>();
      for (const a of accounts) {
        const r = await input.db.query<{ scope: string | null }>(
          `SELECT scope FROM near_user_google_oauth_accounts WHERE line_user_id = $1 AND google_sub = $2`,
          [input.channelUserId, a.googleSub]
        );
        scopeMap.set(a.googleSub, r.rows[0]?.scope ?? "");
      }

      let anyNeedsReauth = false;
      for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i]!;
        const tokenOk = validSubs.has(a.googleSub);
        const mark = a.isActive ? "★" : "　";
        const label = a.email ?? "（メール未取得）";

        if (!tokenOk) {
          lines.push(`  ${mark} ${i + 1}. ${label} — ⚠ トークン復号失敗（再連携が必要）`);
          anyNeedsReauth = true;
          continue;
        }

        const scope = scopeMap.get(a.googleSub) ?? "";
        if (!scope) {
          // scope が空 = tokens.scope が null だった（GCP 未承認スコープの可能性大）
          lines.push(`  ${mark} ${i + 1}. ${label} — ⚠ スコープ情報なし（GCP 同意画面の設定を確認し再連携を）`);
          anyNeedsReauth = true;
        } else {
          const missingScopes = REQUIRED_SCOPES.filter((_, si) => !requiredScopePatterns[si]!.test(scope));
          if (missingScopes.length > 0) {
            lines.push(`  ${mark} ${i + 1}. ${label} — ⚠ スコープ不足: ${missingScopes.join(", ")} が未許可`);
            anyNeedsReauth = true;
          } else {
            lines.push(`  ${mark} ${i + 1}. ${label} — トークン✓ スコープ✓`);
          }
        }
      }

      if (anyNeedsReauth) {
        lines.push("\n⚠ 再連携が必要なアカウントがあります。");
        lines.push("→「**Google連携**」を送って、ブラウザで再許可してください。");
        lines.push("  （Google の許可画面で Drive・スプレッドシート・カレンダーにチェックを入れてください）");
      }
      if (pairs.length === 0) {
        lines.push("\n⚠ 全アカウントのトークンが復号できません。");
        lines.push("原因: GOOGLE_OAUTH_TOKEN_SECRET が変わった可能性があります。");
      }
    } else {
      lines.push("→ まだ連携していません。「**Google連携**」を送ってください。");
    }
  }

  if (!oauthEnvOk && !saOk) {
    lines.push("\n⚠ Sheets を使うには OAuth か サービスアカウントの設定が必要です。");
    lines.push("DEPLOY.md「Google スプレッドシート」を参照してください。");
  }

  return { handled: true, reply: lines.join("\n") };
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
