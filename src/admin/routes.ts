import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { listCapabilityLines } from "../modules/capabilities.js";
import { listRegisteredIntents } from "../modules/registry.js";

export function createAdminApp(): Hono {
  const app = new Hono();
  const env = getEnv();

  app.use("/*", async (c, next) => {
    const bearer = bearerAuth({ token: env.ADMIN_API_KEY });
    return bearer(c, next);
  });

  app.get("/capabilities", (c) => {
    return c.json({
      registered_intents: listRegisteredIntents(),
      user_visible_lines: listCapabilityLines(),
    });
  });

  app.get("/inbound", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, channel, channel_user_id, message_id, message_type, text, created_at
       FROM inbound_messages ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    return c.json({ items: r.rows });
  });

  app.get("/intent-runs", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const pool = getPool();
    const r = await pool.query(
      `SELECT ir.id, ir.inbound_message_id, ir.model, ir.parsed, ir.created_at
       FROM intent_runs ir ORDER BY ir.id DESC LIMIT $1`,
      [limit]
    );
    return c.json({ items: r.rows });
  });

  app.get("/unsupported", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const pool = getPool();
    const r = await pool.query(
      `SELECT * FROM unsupported_requests ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    return c.json({ items: r.rows });
  });

  app.get("/suggestions", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const pool = getPool();
    const r = await pool.query(
      `SELECT * FROM implementation_suggestions ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    return c.json({ items: r.rows });
  });

  app.get("/stats/demand-ranking", async (c) => {
    const pool = getPool();
    const byIntent = await pool.query(
      `SELECT detected_intent AS key, COUNT(*)::int AS count
       FROM unsupported_requests
       GROUP BY detected_intent
       ORDER BY count DESC`
    );
    const byCategory = await pool.query(
      `SELECT COALESCE(suggested_implementation_category, '(null)') AS key, COUNT(*)::int AS count
       FROM unsupported_requests
       GROUP BY suggested_implementation_category
       ORDER BY count DESC`
    );
    return c.json({
      by_detected_intent: byIntent.rows,
      by_suggested_category: byCategory.rows,
    });
  });

  app.get("/tasks", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const pool = getPool();
    const r = await pool.query(`SELECT * FROM tasks ORDER BY id DESC LIMIT $1`, [limit]);
    return c.json({ items: r.rows });
  });

  app.get("/reminders", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const pool = getPool();
    const r = await pool.query(`SELECT * FROM reminders ORDER BY id DESC LIMIT $1`, [limit]);
    return c.json({ items: r.rows });
  });

  return app;
}
