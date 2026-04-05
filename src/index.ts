import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { getEnv } from "./config/env.js";
import { ensureSchema } from "./db/ensureSchema.js";
import { getPool } from "./db/client.js";
import { getLogger } from "./lib/logger.js";
import { verifyLineSignature } from "./channels/line/verify.js";
import { saveInboundMessage } from "./services/inbound_store.js";
import { handleLineTextMessage } from "./services/orchestrator.js";
import { replyOrPush } from "./channels/line/client.js";
import { createAdminApp } from "./admin/routes.js";
import { startReminderCron, dispatchDueReminders } from "./jobs/reminder_dispatcher.js";
import {
  getLineGroupOrRoomId,
  isConfiguredGrowthApprovalGroup,
  isLineGroupOrRoomSource,
  textContainsNearNameReferral,
  textMessageMentionsBot,
} from "./channels/line/groupMention.js";
import { fireAndForgetObserveLineGroup } from "./services/line_group_observation.js";
import { getDeployedAtIso } from "./lib/buildInfo.js";
import {
  escapeHtmlAttr,
  getEffectivePublicBaseUrl,
  getRenderRuntimeInfo,
} from "./lib/renderRuntime.js";
import { createGoogleOAuthApp } from "./routes/oauthGoogle.js";

const app = new Hono();
const log = getLogger();

app.get("/health", (c) => {
  const render = getRenderRuntimeInfo();
  const publicBase = getEffectivePublicBaseUrl();
  return c.json({
    ok: true,
    service: "NEAR",
    built_at: getDeployedAtIso(),
    public_base_url: publicBase ?? null,
    render: render.on_render
      ? {
          external_url: render.external_url,
          dashboard_url: render.dashboard_url,
          service_id: render.service_id,
        }
      : null,
  });
});

/** ブラウザで開きやすい簡易ページ（Render の URL・ダッシュボード導線） */
app.get("/", (c) => {
  const render = getRenderRuntimeInfo();
  const publicBase = getEffectivePublicBaseUrl();
  const parts: string[] = [
    "<!DOCTYPE html>",
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>NEAR</title>",
    "<style>",
    "body{font-family:system-ui,-apple-system,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1.25rem;line-height:1.55;color:#1a1a1a}",
    "h1{font-size:1.35rem}",
    "ul{padding-left:1.2rem}",
    "a{color:#0466c8}",
    "code{font-size:.9em;background:#f0f0f0;padding:.1em .35em;border-radius:4px}",
    "</style></head><body>",
    "<h1>NEAR</h1>",
    "<p>LINE 秘書ボットの HTTP エンドポイントです。</p>",
    "<ul>",
    '<li><a href="/health">/health</a>（JSON・稼働確認）</li>',
  ];
  if (publicBase) {
    const safe = escapeHtmlAttr(publicBase);
    parts.push(
      `<li>公開 URL: <a href="${safe}">${safe}</a>（Webhook は <code>/webhook/line</code>）</li>`
    );
  } else {
    parts.push("<li>公開 URL: 環境変数 <code>PUBLIC_BASE_URL</code> または Render の <code>RENDER_EXTERNAL_URL</code> で表示されます</li>");
  }
  if (render.dashboard_url) {
    const d = escapeHtmlAttr(render.dashboard_url);
    parts.push(
      `<li><a href="${d}" rel="noopener noreferrer">Render ダッシュボード（このサービス）</a></li>`
    );
  } else if (render.on_render) {
    parts.push(
      '<li><a href="https://dashboard.render.com/" rel="noopener noreferrer">Render ダッシュボード</a>（一覧からサービスを開いてください）</li>'
    );
  }
  parts.push("</ul>", "<p style=\"font-size:.9rem;color:#555\">管理 API は <code>/admin</code> 配下（要 <code>Authorization: Bearer …</code>）。</p>", "</body></html>");
  return c.html(parts.join(""));
});

app.post("/internal/reminders/dispatch", async (c) => {
  const env = getEnv();
  if (env.CRON_SECRET) {
    const auth = c.req.header("authorization");
    const expected = `Bearer ${env.CRON_SECRET}`;
    if (auth !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  await dispatchDueReminders();
  return c.json({ ok: true });
});

const admin = createAdminApp();
app.route("/admin", admin);
app.route("/oauth/google", createGoogleOAuthApp());

/** LINE Webhook（Messaging API）。検証・本番とも必ず 200 を返す経路にする。 */
async function lineMessagingWebhook(c: Context) {
  const rawBody = await c.req.text();

  try {
    verifyLineSignature(rawBody, c.req.header("x-line-signature"));
  } catch {
    return c.json({ error: "invalid signature" }, 401);
  }

  let body: { events?: unknown[] };
  try {
    body = JSON.parse(rawBody) as { events?: unknown[] };
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length > 0) {
    log.info({ count: events.length }, "LINE webhook: events received");
  }

  const envLine = getEnv();

  for (const ev of events) {
    const e = ev as Record<string, unknown>;
    if (e.type !== "message") continue;
    const replyToken = e.replyToken as string | undefined;
    const source = e.source as Record<string, unknown> | undefined;
    const userId = source?.userId as string | undefined;
    const message = e.message as Record<string, unknown> | undefined;
    if (!replyToken || !userId || !message) continue;

    const messageType = String(message.type ?? "unknown");
    const messageId = String(message.id ?? "");
    if (!messageId) continue;

    const db = getPool();
    const { id: inboundId, isDuplicate } = await saveInboundMessage(db, {
      channel: "line",
      channelUserId: userId,
      messageId,
      messageType,
      text: messageType === "text" ? String(message.text ?? "") : null,
      rawPayload: ev,
    });

    if (isDuplicate) {
      log.warn({ messageId }, "duplicate LINE message id (webhook retry?); skip to avoid double reply");
      continue;
    }

    const observedGroupId = getLineGroupOrRoomId(source);
    if (observedGroupId) {
      fireAndForgetObserveLineGroup(
        db,
        observedGroupId,
        source?.type === "room" ? "room" : "group"
      );
    }

    const inGroup = isLineGroupOrRoomSource(source);
    if (inGroup) {
      if (messageType !== "text") {
        log.info({ messageId, messageType }, "group/room: skip non-text (need mention or NEAR/ニア)");
        continue;
      }
      const groupText = String(message.text ?? "").trim();
      if (!groupText) continue;
      const isGrowthCapsule =
        envLine.ADMIN_LINE_USER_ID &&
        userId === envLine.ADMIN_LINE_USER_ID &&
        isConfiguredGrowthApprovalGroup(source, envLine.GROWTH_APPROVAL_GROUP_ID);
      if (!isGrowthCapsule) {
        const botId = envLine.LINE_BOT_USER_ID;
        const mentioned = botId ? textMessageMentionsBot(message, botId) : false;
        const nameRef = textContainsNearNameReferral(groupText);
        if (!mentioned && !nameRef) {
          log.info({ messageId }, "group/room: skip (no bot mention and no NEAR/ニア in text)");
          continue;
        }
      }
    }

    if (messageType !== "text") {
      const draft =
        "現在はテキストメッセージを中心に対応しております。画像やファイルなどは、のちほど扱えるよう拡張予定です。";
      await replyOrPush(replyToken, userId, draft);
      continue;
    }

    const text = String(message.text ?? "").trim();
    if (!text) continue;

    await handleLineTextMessage({
      db,
      replyToken,
      channelUserId: userId,
      text,
      inboundMessageId: inboundId,
    });
  }

  return c.json({ ok: true });
}

app.get("/webhook/line", (c) => c.text("NEAR LINE webhook OK", 200));
app.get("/webhook", (c) => c.text("NEAR webhook root OK (use POST /webhook/line)", 200));

app.post("/webhook/line", lineMessagingWebhook);
app.post("/webhook/line/", lineMessagingWebhook);
/** `/line` 抜けで設定してしまうケース向け */
app.post("/webhook", lineMessagingWebhook);
app.post("/webhook/", lineMessagingWebhook);

async function main() {
  getEnv();
  await ensureSchema();
  startReminderCron();

  const env = getEnv();
  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      log.info({ port: info.port }, "NEAR server listening");
    }
  );
}

main().catch((e) => {
  log.error({ err: e }, "fatal");
  process.exit(1);
});
