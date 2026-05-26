import type { Db } from "./client.js";
import { getEnv, type Env } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import { saveMessageFromLineEvent } from "../services/supabase/repositories/messages.js";
import { linkConversationForAgentKey } from "../services/customers/lineResolve.js";
import { VELIORA_AGENT_NEAR, buildVelioraConversationKey } from "../veliora/constants.js";

export type VelioraLineDirection = "inbound" | "outbound";

type AppendInput = {
  direction: VelioraLineDirection;
  channel: string;
  lineUserId: string;
  actorUserId?: string | null;
  groupId?: string | null;
  lineMessageId?: string | null;
  messageType?: string | null;
  bodyText?: string | null;
  rawPayload: unknown;
  legacySchema: string;
  legacyTable: string;
  legacyRowId?: number | null;
};

function shouldWriteCanonical(env: Env, legacyRowId: number | null | undefined): boolean {
  if (legacyRowId == null) return false;
  if (env.VELIORA_CANONICAL_LINE_LOG) return true;
  return env.VELIORA_CORE_DUAL_WRITE;
}

/**
 * Veliora 共通 LINE ログへ追記。失敗しても本処理は継続（警告ログのみ）。
 * 正典は veliora.messages。veliora_line_legacy.line_message_events は VELIORA_LEGACY_LINE_LOG で制御。
 */
export async function appendVelioraNearLineEvent(db: Db, input: AppendInput): Promise<void> {
  const log = getLogger();
  const env = getEnv();
  const conversationKey = buildVelioraConversationKey(
    VELIORA_AGENT_NEAR,
    input.channel,
    input.lineUserId,
    input.groupId
  );

  if (shouldWriteCanonical(env, input.legacyRowId)) {
    try {
      await saveMessageFromLineEvent(db, {
        agentKey: VELIORA_AGENT_NEAR,
        conversationKey,
        direction: input.direction,
        lineUserId: input.lineUserId,
        groupId: input.groupId,
        bodyText: input.bodyText,
        messageType: input.messageType,
        rawPayload: input.rawPayload,
        legacySchema: input.legacySchema,
        legacyTable: input.legacyTable,
        legacyRowId: input.legacyRowId!,
      });
      void linkConversationForAgentKey(db, {
        agentKey: VELIORA_AGENT_NEAR,
        conversationKey,
        lineUserId: input.lineUserId,
      }).catch(() => undefined);
    } catch (e) {
      log.warn({ err: e }, "veliora.messages canonical write failed (non-fatal)");
    }
  }

  if (!env.VELIORA_LEGACY_LINE_LOG) return;

  try {
    await db.query(
      `INSERT INTO veliora.line_message_events (
        agent_code, direction, channel, line_user_id, actor_user_id, group_id, conversation_key,
        line_message_id, message_type, body_text, raw_payload, legacy_schema, legacy_table, legacy_row_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
      [
        VELIORA_AGENT_NEAR,
        input.direction,
        input.channel,
        input.lineUserId,
        input.actorUserId ?? null,
        input.groupId ?? null,
        conversationKey,
        input.lineMessageId ?? null,
        input.messageType ?? null,
        input.bodyText ?? null,
        JSON.stringify(input.rawPayload ?? {}),
        input.legacySchema,
        input.legacyTable,
        input.legacyRowId ?? null,
      ]
    );
  } catch (e) {
    log.warn({ err: e }, "appendVelioraNearLineEvent legacy veliora write failed (non-fatal)");
  }
}
