-- Veliora Vegapunk: 索引・RLS・コメント

CREATE INDEX IF NOT EXISTS idx_customers_status_updated
  ON veriora.customers (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_identities_customer
  ON veriora.customer_identities (customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_identities_external_display
  ON veriora.customer_identities (external_display_name)
  WHERE external_display_name IS NOT NULL AND btrim(external_display_name) <> '';

CREATE INDEX IF NOT EXISTS idx_customer_merge_candidates_status
  ON veriora.customer_merge_candidates (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_customer_confirmed
  ON veriora.customer_profiles (customer_id, confirmed, profile_type);

CREATE INDEX IF NOT EXISTS idx_conversations_customer_id
  ON veriora.conversations (customer_id)
  WHERE customer_id IS NOT NULL;

ALTER TABLE IF EXISTS veriora.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS veriora.customer_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS veriora.customer_merge_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS veriora.customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS veriora.customer_memory_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS veriora.customer_agent_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS veriora.customer_conversation_links ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN veriora.customer_profiles.confirmed IS
  'true=ユーザー明示または管理者確認。false=AI推測。';
COMMENT ON COLUMN veriora.customer_profiles.is_sensitive IS
  'センシティブ扱い。基本は保存しない。';
