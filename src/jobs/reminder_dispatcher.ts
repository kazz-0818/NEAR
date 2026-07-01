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
      actor_user_id: string | null;
      group_id: string | null;
      message: string;
    }>(
      `SELECT id, channel_user_id, actor_user_id, group_id, message FROM near_reminders
       WHERE status = 'pending' AND remind_at <= $1::timestamptz
       ORDER BY remind_at ASC
       LIMIT 20
       FOR UPDATE SKIP LOCKED`,
      [now]
    );

    for (const row of sel.rows) {
      try {
        // channel_user_id / actor_user_id は発言者の LINE userId（グループ内登録でも DM で通知）
        const pushTo = (row.actor_user_id ?? row.channel_user_id)?.trim();
        if (!pushTo) {
          log.error({ reminderId: row.id }, "reminder dispatch skipped: no push target");
          continue;
        }
        await pushText(pushTo, `【NEARリマインド】${row.message}`);
        await client.query(`UPDATE near_reminders SET status = 'sent' WHERE id = $1`, [row.id]);
        log.info({ reminderId: row.id, pushTo: pushTo.slice(0, 12) }, "reminder dispatched");
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
