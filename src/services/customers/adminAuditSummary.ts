import type { Db } from "../../db/client.js";
import { VERIORA_TABLES } from "../supabase/schema.js";
import { listMergeCandidates } from "../supabase/repositories/customerMergeCandidates.js";

const SENSITIVE_PATTERN =
  /健康|病気|宗教|政治|性的|犯罪|人種|民族|労働組合|住所|マンション番号|丁目|番地\d/i;

/** RITS 日次レポート・管理 UI 用（読取のみ） */
export async function buildCustomerAuditSummary(db: Db): Promise<Record<string, unknown>> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [active, new24h, pending, memConfirmed, memUnconfirmed, agentMsgs, multiAgent] =
    await Promise.all([
      db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ${VERIORA_TABLES.customers} WHERE status = 'active'`,
      ),
      db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ${VERIORA_TABLES.customers}
         WHERE status = 'active' AND created_at >= $1::timestamptz`,
        [since24h],
      ),
      listMergeCandidates(db, "pending"),
      db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ${VERIORA_TABLES.customerMemoryNotes} WHERE confirmed = true`,
      ),
      db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ${VERIORA_TABLES.customerMemoryNotes} WHERE confirmed = false`,
      ),
      db.query<{ agent_key: string; n: string }>(
        `SELECT a.agent_key, COUNT(*)::text AS n
         FROM veriora.messages m
         JOIN veriora.ai_agents a ON a.id = m.agent_id
         WHERE m.created_at >= $1::timestamptz
         GROUP BY a.agent_key ORDER BY COUNT(*) DESC`,
        [since24h],
      ),
      db.query<{ customer_id: string; agent_count: string }>(
        `SELECT l.customer_id, COUNT(DISTINCT COALESCE(l.agent_key, a.agent_key))::text AS agent_count
         FROM ${VERIORA_TABLES.customerConversationLinks} l
         JOIN veriora.conversations c ON c.id = l.conversation_id
         JOIN veriora.ai_agents a ON a.id = c.agent_id
         WHERE c.last_message_at >= $1::timestamptz
         GROUP BY l.customer_id
         HAVING COUNT(DISTINCT COALESCE(l.agent_key, a.agent_key)) > 1
         ORDER BY COUNT(DISTINCT COALESCE(l.agent_key, a.agent_key)) DESC
         LIMIT 20`,
        [since24h],
      ),
    ]);

  const needsReview = await db.query<{
    id: string;
    customer_id: string;
    note: string;
    category: string | null;
    confirmed: boolean;
  }>(
    `SELECT id, customer_id, note, category, confirmed
     FROM ${VERIORA_TABLES.customerMemoryNotes}
     WHERE confirmed = false
     ORDER BY created_at DESC LIMIT 15`,
  );

  const sensitiveCandidates = await db.query<{
    id: string;
    customer_id: string;
    note: string;
  }>(
    `SELECT id, customer_id, note
     FROM ${VERIORA_TABLES.customerMemoryNotes}
     ORDER BY created_at DESC LIMIT 80`,
  );

  const sensitive = sensitiveCandidates.rows.filter((r) => SENSITIVE_PATTERN.test(r.note)).slice(0, 10);

  const nameMismatch = await db.query<{
    customer_id: string;
    display_name: string | null;
    preferred_name: string | null;
    identity_names: string;
  }>(
    `SELECT c.id AS customer_id, c.display_name, c.preferred_name,
            string_agg(DISTINCT ci.external_display_name, ', ') AS identity_names
     FROM ${VERIORA_TABLES.customers} c
     JOIN ${VERIORA_TABLES.customerIdentities} ci ON ci.customer_id = c.id
     WHERE c.status = 'active'
       AND c.preferred_name IS NOT NULL AND btrim(c.preferred_name) <> ''
       AND ci.external_display_name IS NOT NULL
     GROUP BY c.id, c.display_name, c.preferred_name
     HAVING NOT bool_or(btrim(ci.external_display_name) ILIKE '%' || btrim(c.preferred_name) || '%')
     LIMIT 10`,
  );

  const underusedCrossAgent = await db.query<{
    customer_id: string;
    sera_notes: string;
    near_ctx_len: string;
  }>(
    `SELECT n.customer_id,
            COUNT(*) FILTER (WHERE n.source_agent_key = 'sera')::text AS sera_notes,
            COALESCE(MAX(LENGTH(ac.context_summary)) FILTER (WHERE ac.agent_key = 'near'), '0') AS near_ctx_len
     FROM ${VERIORA_TABLES.customerMemoryNotes} n
     LEFT JOIN ${VERIORA_TABLES.customerAgentContexts} ac ON ac.customer_id = n.customer_id
     WHERE n.confirmed = true
     GROUP BY n.customer_id
     HAVING COUNT(*) FILTER (WHERE n.source_agent_key = 'sera') > 0
        AND COALESCE(MAX(LENGTH(ac.context_summary)) FILTER (WHERE ac.agent_key = 'near'), 0) < 20
     LIMIT 10`,
  );

  return {
    window_start_utc: since24h,
    customers_active: Number(active.rows[0]?.n ?? 0),
    customers_new_24h: Number(new24h.rows[0]?.n ?? 0),
    merge_candidates_pending: pending.length,
    memory_confirmed: Number(memConfirmed.rows[0]?.n ?? 0),
    memory_unconfirmed: Number(memUnconfirmed.rows[0]?.n ?? 0),
    agent_message_counts_24h: agentMsgs.rows,
    multi_agent_customers_24h: multiAgent.rows,
    merge_candidates: pending.slice(0, 20),
    needs_review_notes: needsReview.rows,
    sensitive_note_candidates: sensitive,
    preferred_name_mismatch: nameMismatch.rows,
    cross_agent_underused: underusedCrossAgent.rows,
  };
}

export async function listCustomerConversations(
  db: Db,
  customerId: string,
  limit = 30
): Promise<
  Array<{
    conversation_id: string;
    agent_key: string;
    line_user_id: string | null;
    last_message_at: string | null;
    message_count: number;
  }>
> {
  const r = await db.query<{
    conversation_id: string;
    agent_key: string;
    line_user_id: string | null;
    last_message_at: string | null;
    message_count: number;
  }>(
    `SELECT c.id AS conversation_id, a.agent_key, c.line_user_id, c.last_message_at,
            (SELECT COUNT(*)::int FROM veriora.messages m WHERE m.conversation_id = c.id) AS message_count
     FROM ${VERIORA_TABLES.customerConversationLinks} l
     JOIN veriora.conversations c ON c.id = l.conversation_id
     JOIN veriora.ai_agents a ON a.id = c.agent_id
     WHERE l.customer_id = $1
     ORDER BY c.last_message_at DESC NULLS LAST
     LIMIT $2`,
    [customerId, limit]
  );
  return r.rows;
}

export async function listCustomerMessages(
  db: Db,
  customerId: string,
  limit = 40
): Promise<
  Array<{
    id: string;
    agent_key: string;
    direction: string;
    role: string;
    text: string | null;
    created_at: string;
  }>
> {
  const r = await db.query<{
    id: string;
    agent_key: string;
    direction: string;
    role: string;
    text: string | null;
    created_at: string;
  }>(
    `SELECT m.id, a.agent_key, m.direction, m.role, m.text, m.created_at
     FROM veriora.messages m
     JOIN veriora.conversations c ON c.id = m.conversation_id
     JOIN ${VERIORA_TABLES.customerConversationLinks} l ON l.conversation_id = c.id
     JOIN veriora.ai_agents a ON a.id = m.agent_id
     WHERE l.customer_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [customerId, limit]
  );
  return r.rows;
}
