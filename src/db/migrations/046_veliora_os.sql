-- Veliora OS: 全 AI 共通の LINE 履歴ログ + ai_agents マスタ。
-- 既存 near.* / sera.* テーブルは変更しない。互換用 VIEW のみ追加。

CREATE SCHEMA IF NOT EXISTS veliora;

CREATE TABLE IF NOT EXISTS veliora.ai_agents (
  agent_code   TEXT        PRIMARY KEY,
  display_name TEXT        NOT NULL,
  parent_brand TEXT        NOT NULL DEFAULT 'Veliora OS',
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO veliora.ai_agents (agent_code, display_name, parent_brand) VALUES
  ('near', 'NEAR', 'Veliora OS'),
  ('sera', 'SERA', 'Veliora OS'),
  ('nia',  'NIA',  'Veliora OS'),
  ('irie', 'IRIE', 'Veliora OS')
ON CONFLICT (agent_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS veliora.line_message_events (
  id                 BIGSERIAL PRIMARY KEY,
  agent_code         TEXT        NOT NULL REFERENCES veliora.ai_agents (agent_code) ON DELETE RESTRICT,
  direction          TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel            TEXT        NOT NULL DEFAULT 'line',
  line_user_id       TEXT        NOT NULL,
  actor_user_id      TEXT,
  group_id           TEXT,
  conversation_key   TEXT        NOT NULL,
  line_message_id    TEXT,
  message_type       TEXT,
  body_text          TEXT,
  raw_payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  legacy_schema      TEXT        NOT NULL,
  legacy_table       TEXT        NOT NULL,
  legacy_row_id      BIGINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veliora_line_events_agent_created
  ON veliora.line_message_events (agent_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_veliora_line_events_user
  ON veliora.line_message_events (agent_code, line_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_veliora_line_events_group
  ON veliora.line_message_events (agent_code, group_id, created_at DESC)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_veliora_line_events_conversation
  ON veliora.line_message_events (conversation_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_veliora_line_events_line_msg_id
  ON veliora.line_message_events (agent_code, line_message_id)
  WHERE line_message_id IS NOT NULL;

-- 統一閲覧用エイリアス（既存テーブル名は変更しない）
CREATE OR REPLACE VIEW veliora.line_messages AS
  SELECT
    id,
    agent_code,
    direction,
    channel,
    line_user_id,
    actor_user_id,
    group_id,
    conversation_key,
    line_message_id,
    message_type,
    body_text AS text,
    raw_payload,
    legacy_schema,
    legacy_table,
    legacy_row_id,
    created_at
  FROM veliora.line_message_events;

-- NEAR 由来の未対応・提案を Veliora 名前空間からも参照（読み取り専用）
CREATE OR REPLACE VIEW veliora.unsupported_requests AS
  SELECT * FROM near.near_unsupported_requests;

CREATE OR REPLACE VIEW veliora.implementation_suggestions AS
  SELECT * FROM near.near_implementation_suggestions;
