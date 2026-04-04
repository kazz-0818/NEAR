import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { listCapabilityLines } from "../modules/capabilities.js";
import { listRegisteredIntents } from "../modules/registry.js";

const APPROVAL_STATUSES = ["pending", "approved", "rejected", "implemented"] as const;
type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

function isAllowedApprovalTransition(from: string, to: ApprovalStatus): boolean {
  if (from === to) return true;
  if (from === "pending" && (to === "approved" || to === "rejected")) return true;
  if (from === "approved" && to === "implemented") return true;
  return false;
}

const patchSuggestionBody = z.object({
  approval_status: z.enum(APPROVAL_STATUSES),
  review_notes: z.string().nullable().optional(),
});

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
    const status = c.req.query("status");
    const pool = getPool();
    const params: unknown[] = [];
    let where = "";
    if (status && APPROVAL_STATUSES.includes(status as ApprovalStatus)) {
      params.push(status);
      where = `WHERE approval_status = $${params.length}`;
    }
    params.push(limit);
    const limParam = `$${params.length}`;
    const r = await pool.query(
      `SELECT * FROM implementation_suggestions ${where} ORDER BY id DESC LIMIT ${limParam}`,
      params
    );
    return c.json({ items: r.rows });
  });

  app.get("/suggestions/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id < 1) {
      return c.json({ error: "invalid id" }, 400);
    }
    const pool = getPool();
    const r = await pool.query(`SELECT * FROM implementation_suggestions WHERE id = $1`, [id]);
    if (r.rows.length === 0) return c.json({ error: "not found" }, 404);
    return c.json(r.rows[0]);
  });

  app.patch("/suggestions/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id < 1) {
      return c.json({ error: "invalid id" }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = patchSuggestionBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const pool = getPool();
    const cur = await pool.query<{ approval_status: string }>(
      `SELECT approval_status FROM implementation_suggestions WHERE id = $1`,
      [id]
    );
    if (cur.rows.length === 0) return c.json({ error: "not found" }, 404);
    const from = cur.rows[0].approval_status;
    const to = parsed.data.approval_status;
    if (!isAllowedApprovalTransition(from, to)) {
      return c.json({ error: `invalid transition: ${from} -> ${to}` }, 400);
    }
    await pool.query(
      `UPDATE implementation_suggestions
       SET approval_status = $1,
           review_notes = COALESCE($2, review_notes),
           reviewed_at = now()
       WHERE id = $3`,
      [to, parsed.data.review_notes ?? null, id]
    );
    return c.json({ ok: true, id, approval_status: to });
  });

  app.get("/stats/fingerprint-demand", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const pool = getPool();
    const r = await pool.query(
      `SELECT message_fingerprint,
              COUNT(*)::int AS count,
              MAX(original_message) AS sample_message
       FROM unsupported_requests
       WHERE message_fingerprint IS NOT NULL AND message_fingerprint <> ''
       GROUP BY message_fingerprint
       ORDER BY count DESC
       LIMIT $1`,
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
