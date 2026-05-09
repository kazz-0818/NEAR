ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS quoted_message_id TEXT;

ALTER TABLE outbound_messages
  ADD COLUMN IF NOT EXISTS line_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_inbound_quoted_message_id
  ON inbound_messages (channel, quoted_message_id);

CREATE INDEX IF NOT EXISTS idx_outbound_line_message_id
  ON outbound_messages (channel, line_message_id);
