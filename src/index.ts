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
  isConfiguredGrowthApprovalGroup,
  isLineGroupOrRoomSource,
  textContainsNearNameReferral,
  textMessageMentionsBot,
} from "./channels/line/groupMention.js";
import { getDeployedAtIso } from "./lib/buildInfo.js";

const app = new Hono();
const log = getLogger();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "NEAR",
    built_at: getDeployedAtIso(),
  })
);

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
