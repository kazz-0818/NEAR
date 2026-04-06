import type { Db } from "./client.js";

export type InsertAgentToolRunInput = {
  db: Db;
  channel: string;
  channelUserId: string;
  inboundMessageId: number;
  toolName: string;
  ok: boolean;
  situation: string | null;
  durationMs: number;
  errorCode: string | null;
};

export async function insertAgentToolRun(input: InsertAgentToolRunInput): Promise<void> {
  await input.db.query(
    `INSERT INTO agent_tool_runs (
       channel, channel_user_id, inbound_message_id, tool_name, ok, situation, duration_ms, error_code
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.channel,
      input.channelUserId,
      input.inboundMessageId,
      input.toolName,
      input.ok,
      input.situation,
      input.durationMs,
      input.errorCode,
    ]
  );
}
