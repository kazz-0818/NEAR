-- NEAR: per-user long-term memory (preferences, workflow, how to address — not model fine-tuning)

CREATE TABLE IF NOT EXISTS near.near_user_memory (
  line_user_id TEXT PRIMARY KEY,
  memory_summary TEXT NOT NULL DEFAULT '',
  memory_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  call_preference TEXT,
  last_consolidated_inbound_id BIGINT,
  consolidation_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS near_user_memory_updated_at_idx
  ON near.near_user_memory (updated_at DESC);

COMMENT ON TABLE near.near_user_memory IS
  'LINE ユーザーごとの長期記憶（要約 + 構造化ファクト）。会話後に LLM で段階更新。';
COMMENT ON COLUMN near.near_user_memory.memory_summary IS 'その人についてのローリング要約（PII はマスク推奨）';
COMMENT ON COLUMN near.near_user_memory.memory_facts IS '[{fact, category, confidence, learned_at}] 配列';
COMMENT ON COLUMN near.near_user_memory.call_preference IS '呼び方の好み（例: 名字のみ、敬称なし）';
