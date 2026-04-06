import type { Db } from "./client.js";

export async function insertAgentSearchRun(
  db: Db,
  input: {
    channel: string;
    channelUserId: string;
    inboundMessageId: number;
    policyEnabled: boolean;
    attachedWebSearch: boolean;
    reasonCode: string;
    userTextLen: number;
    toolNames: string[];
  }
): Promise<void> {
  await db.query(
    `INSERT INTO agent_search_runs (
       channel, channel_user_id, inbound_message_id, policy_enabled, attached_web_search, reason_code, user_text_chars, tool_names
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[])`,
    [
      input.channel,
      input.channelUserId,
      input.inboundMessageId,
      input.policyEnabled,
      input.attachedWebSearch,
      input.reasonCode.slice(0, 64),
      input.userTextLen,
      input.toolNames,
    ]
  );
}
