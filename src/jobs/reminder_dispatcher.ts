import cron from "node-cron";
import { getPool } from "../db/client.js";
import { pushText } from "../channels/line/client.js";
import { getLogger } from "../lib/logger.js";

async function dispatchDueReminders(): Promise<void> {
  const log = getLogger();
  const pool = getPool();
  const now = new Date().toISOString();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sel = await client.query<{
      id: string;
      channel_user_id: string;
      message: string;
    }>(
      `SELECT id, channel_user_id, message FROM reminders
       WHERE status = 'pending' AND remind_at <= $1::timestamptz
       ORDER BY remind_at ASC
       LIMIT 20
       FOR UPDATE SKIP LOCKED`,
      [now]
    );

    for (const row of sel.rows) {
      try {
        await pushText(row.channel_user_id, `【NEARリマインド】${row.message}`);
        await client.query(`UPDATE reminders SET status = 'sent' WHERE id = $1`, [row.id]);
      } catch (e) {
        log.error({ err: e, reminderId: row.id }, "reminder dispatch failed for one row");
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    log.error({ err: e }, "reminder dispatcher transaction failed");
  } finally {
    client.release();
  }
}

export function startReminderCron(): void {
  const log = getLogger();
  cron.schedule("* * * * *", () => {
    void dispatchDueReminders().catch((e) => log.error({ err: e }, "dispatchDueReminders"));
  });
  log.info("Reminder cron started (every minute)");
}

export { dispatchDueReminders };
