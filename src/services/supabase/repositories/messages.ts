import type { VelioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";
import { getAgentByKey } from "./agents.js";
import { upsertConversation } from "./conversations.js";

export type SaveMessageInput = {
  agentKey: string;
  conversationKey: string;
  source?: string;
  lineUserId?: string | null;
  lineGroupId?: string | null;
  direction: "inbound" | "outbound" | "internal" | "system";
  role: "user" | "assistant" | "system" | "tool";
  messageType?: string;
  text?: string | null;
  rawPayload?: Record<string, unknown>;
  toolCalls?: unknown[];
  metadata?: Record<string, unknown>;
  legacySchema?: string | null;
  legacyTable?: string | null;
  legacyRowId?: number | null;
  createdAt?: Date;
};

export async function saveMessage(db: VelioraDb, input: SaveMessageInput): Promise<{ id: string }> {
  const agent = await getAgentByKey(db, input.agentKey);
  if (!agent) throw new Error(`saveMessage: unknown agent_key ${input.agentKey}`);

  const { id: conversationId } = await upsertConversation(db, {
    agentId: agent.id,
    source: input.source ?? "line",
    conversationKey: input.conversationKey,
    lineUserId: input.lineUserId,
    lineGroupId: input.lineGroupId,
  });

  if (input.legacyRowId != null && input.legacySchema && input.legacyTable) {
    const dup = await db.query<{ id: string }>(
      `SELECT id FROM ${VERIORA_TABLES.messages}
       WHERE legacy_schema = $1 AND legacy_table = $2 AND legacy_row_id = $3 LIMIT 1`,
      [input.legacySchema, input.legacyTable, input.legacyRowId]
    );
    if (dup.rows[0]?.id) return { id: dup.rows[0].id };
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.messages} (
      conversation_id, agent_id, direction, role, message_type, text,
      raw_payload, tool_calls, metadata,
      legacy_schema, legacy_table, legacy_row_id, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12, COALESCE($13, now()))
    RETURNING id`,
    [
      conversationId,
      agent.id,
      input.direction,
      input.role,
      input.messageType ?? "text",
      input.text ?? null,
      JSON.stringify(input.rawPayload ?? {}),
      JSON.stringify(input.toolCalls ?? []),
      JSON.stringify(input.metadata ?? {}),
      input.legacySchema ?? null,
      input.legacyTable ?? null,
      input.legacyRowId ?? null,
      input.createdAt ?? null,
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("saveMessage: insert failed");
  return { id };
}

export type MessageRow = {
  id: string;
  conversation_id: string;
  agent_id: string;
  direction: string;
  role: string;
  message_type: string;
  text: string | null;
  created_at: Date;
};

export async function listMessagesByConversation(
  db: VelioraDb,
  conversationId: string,
  limit = 100
): Promise<MessageRow[]> {
  const lim = Math.min(Math.max(limit, 1), 500);
  const r = await db.query<MessageRow>(
    `SELECT id, conversation_id, agent_id, direction, role, message_type, text, created_at
     FROM ${VERIORA_TABLES.messages}
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, lim]
  );
  return r.rows;
}

/** LINE イベントから canonical messages へ（デュアル書き込み用） */
export async function saveMessageFromLineEvent(
  db: VelioraDb,
  input: {
    agentKey: string;
    conversationKey: string;
    direction: "inbound" | "outbound";
    lineUserId: string;
    groupId?: string | null;
    bodyText?: string | null;
    messageType?: string | null;
    rawPayload: unknown;
    legacySchema: string;
    legacyTable: string;
    legacyRowId: number;
  }
): Promise<void> {
  await saveMessage(db, {
    agentKey: input.agentKey,
    conversationKey: input.conversationKey,
    lineUserId: input.lineUserId,
    lineGroupId: input.groupId,
    direction: input.direction,
    role: input.direction === "inbound" ? "user" : "assistant",
    messageType: input.messageType ?? "text",
    text: input.bodyText,
    rawPayload:
      typeof input.rawPayload === "object" && input.rawPayload !== null
        ? (input.rawPayload as Record<string, unknown>)
        : {},
    legacySchema: input.legacySchema,
    legacyTable: input.legacyTable,
    legacyRowId: input.legacyRowId,
  });
}
