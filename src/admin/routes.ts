import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { listCapabilityLines } from "../modules/capabilities.js";
import { listRegisteredIntents } from "../modules/registry.js";
import { patchApprovalStatus, patchImplementationState } from "../services/approval_service.js";
import { GROWTH_APPROVAL_STATUSES, IMPLEMENTATION_STATES } from "../services/growth_constants.js";
import {
  handleAdminAffirmativeFinalApproval,
  handleAdminGrowthComplete,
  startHearingFlow,
} from "../services/growth_orchestrator.js";

const patchSuggestionBody = z
  .object({
    approval_status: z.enum(GROWTH_APPROVAL_STATUSES).optional(),
    implementation_state: z.enum(IMPLEMENTATION_STATES).optional(),
    deploy_safety_confirmed: z.boolean().optional(),
    failure_reason: z.string().nullable().optional(),
    review_notes: z.string().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "empty patch" });

export function createAdminApp(): Hono {
  const app = new Hono();
  const env = getEnv();

  app.use("/*", async (c, next) => {
    const bearer = bearerAuth({ token: env.ADMIN_API_KEY });
    return bearer(c, next);
  });

  app.get("/capabilities", async (c) => {
    const pool = getPool();
    const lines = await listCapabilityLines(pool);
    return c.json({
      registered_intents: listRegisteredIntents(),
      user_visible_lines: lines,
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

  /** エージェント経路のカスタムツール実行ログ */
  app.get("/agent-tool-runs", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 80), 300);
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, created_at, channel, channel_user_id, inbound_message_id, tool_name, ok, situation, duration_ms, error_code
       FROM agent_tool_runs ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    return c.json({ items: r.rows });
  });

  /** Web 検索ツール付与判定ログ（Phase2 ポリシー／監査用） */
  app.get("/agent-search-runs", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 80), 300);
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, created_at, channel, channel_user_id, inbound_message_id, policy_enabled, attached_web_search, reason_code, user_text_chars, tool_names
       FROM agent_search_runs ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    return c.json({ items: r.rows });
  });

  /** エージェント副作用ツールの保留中確認（args は保存済みスナップショット） */
  app.get("/pending-tool-confirmations", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, created_at, expires_at, channel, channel_user_id, status, tool_name, args_json, inbound_message_id
       FROM pending_tool_confirmations
       WHERE status = 'pending' AND expires_at > now()
       ORDER BY id DESC LIMIT $1`,
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

  /** 成長パイプライン各段階のイベント（gate / 提案生成 / 通知 等） */
  app.get("/growth-funnel-events", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
    const unsupportedIdRaw = c.req.query("unsupported_id");
    const usNum =
      unsupportedIdRaw != null && unsupportedIdRaw !== "" && Number.isFinite(Number(unsupportedIdRaw))
        ? Number(unsupportedIdRaw)
        : null;
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, created_at, inbound_message_id, unsupported_request_id, channel, channel_user_id, step, allowed, reason_code, detail
       FROM growth_funnel_events
       WHERE ($1::bigint IS NULL OR unsupported_request_id = $1)
       ORDER BY id DESC LIMIT $2`,
      [usNum, limit]
    );
    return c.json({ items: r.rows });
  });

  /** unsupported 以外の「実質未解決」シグナル（エージェント・レガシー error 等） */
  app.get("/growth-candidate-signals", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 80), 400);
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, created_at, inbound_message_id, channel, channel_user_id, source, reason_code, detail, parsed_intent_snapshot
       FROM growth_candidate_signals ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    return c.json({ items: r.rows });
  });

  /** 直近30日の funnel 集計 + unsupported ステータス件数 */
  app.get("/growth-pipeline/summary", async (c) => {
    const pool = getPool();
    const funnel = await pool.query(
      `SELECT step, reason_code, COUNT(*)::int AS count
       FROM growth_funnel_events
       WHERE created_at > now() - interval '30 days'
       GROUP BY step, reason_code
       ORDER BY count DESC`
    );
    const unsupportedByStatus = await pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM unsupported_requests
       WHERE created_at > now() - interval '30 days'
       GROUP BY status
       ORDER BY count DESC`
    );
    const suggestionsByApproval = await pool.query(
      `SELECT approval_status, COUNT(*)::int AS count
       FROM implementation_suggestions
       WHERE created_at > now() - interval '30 days'
       GROUP BY approval_status
       ORDER BY count DESC`
    );
    return c.json({
      period_days: 30,
      funnel_by_step_and_reason: funnel.rows,
      unsupported_by_status: unsupportedByStatus.rows,
      suggestions_by_approval_status: suggestionsByApproval.rows,
    });
  });

  app.get("/suggestions", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const status = c.req.query("status");
    const pool = getPool();
    const params: unknown[] = [];
    let where = "";
    if (status && GROWTH_APPROVAL_STATUSES.includes(status as (typeof GROWTH_APPROVAL_STATUSES)[number])) {
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

  /** `cursor_prompt` 全文を text/plain で返す（curl でファイル化しやすい） */
  app.get("/suggestions/:id/cursor-prompt", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id < 1) {
      return c.text("invalid id", 400);
    }
    const pool = getPool();
    const r = await pool.query<{ cursor_prompt: string | null }>(
      `SELECT cursor_prompt FROM implementation_suggestions WHERE id = $1`,
      [id]
    );
    if (r.rows.length === 0) return c.text("not found", 404);
    const text = r.rows[0]?.cursor_prompt ?? "";
    return c.text(text, 200, { "Content-Type": "text/plain; charset=utf-8" });
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

  /** 第二承認（API 経由）。LINE と同じく cursor_prompt 再生成・通知まで実行 */
  app.post("/suggestions/:id/growth/second-approve", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id < 1) return c.json({ error: "invalid id" }, 400);
    if (!env.ADMIN_LINE_USER_ID) {
      return c.json({ error: "ADMIN_LINE_USER_ID required for LINE notifications" }, 400);
    }
    const pool = getPool();
    const msg = await handleAdminAffirmativeFinalApproval(pool, env.ADMIN_LINE_USER_ID, id);
    return c.json({ ok: true, message: msg });
  });

  app.post("/suggestions/:id/growth/complete", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id < 1) return c.json({ error: "invalid id" }, 400);
    if (!env.ADMIN_LINE_USER_ID) {
      return c.json({ error: "ADMIN_LINE_USER_ID required for LINE notifications" }, 400);
    }
    const pool = getPool();
    const msg = await handleAdminGrowthComplete(pool, env.ADMIN_LINE_USER_ID, id);
    return c.json({ ok: true, message: msg });
  });

  app.get("/suggestions/:id/hearing", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id < 1) return c.json({ error: "invalid id" }, 400);
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, sort_order, question_key, question_text, answer_text, asked_at, answered_at
       FROM growth_hearing_items WHERE implementation_suggestion_id = $1 ORDER BY sort_order`,
      [id]
    );
    return c.json({ items: r.rows });
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

    if (parsed.data.approval_status != null) {
      const r = await patchApprovalStatus(pool, id, parsed.data.approval_status, parsed.data.review_notes ?? null);
      if (!r.ok) return c.json({ error: r.error }, 400);
      if (parsed.data.approval_status === "approved" && env.ADMIN_LINE_USER_ID) {
        await startHearingFlow(pool, env.ADMIN_LINE_USER_ID, id);
      }
    }

    if (parsed.data.implementation_state != null) {
      const r = await patchImplementationState(pool, id, parsed.data.implementation_state, {
        failureReason: parsed.data.failure_reason ?? undefined,
        deploySafetyConfirmed: parsed.data.deploy_safety_confirmed === true,
      });
      if (!r.ok) return c.json({ error: r.error }, 400);
    } else if (parsed.data.failure_reason != null || parsed.data.review_notes != null) {
      await pool.query(
        `UPDATE implementation_suggestions
         SET review_notes = COALESCE($1, review_notes),
             failure_reason = COALESCE($2, failure_reason),
             updated_at = now()
         WHERE id = $3`,
        [parsed.data.review_notes ?? null, parsed.data.failure_reason ?? null, id]
      );
    }

    const cur = await pool.query(`SELECT approval_status, implementation_state FROM implementation_suggestions WHERE id = $1`, [
      id,
    ]);
    return c.json({ ok: true, id, ...cur.rows[0] });
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
