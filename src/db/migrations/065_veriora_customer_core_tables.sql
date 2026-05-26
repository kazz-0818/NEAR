-- Veliora Vegapunk: 共通顧客マスター（core）
-- 非破壊: CREATE / ADD COLUMN のみ

CREATE TABLE IF NOT EXISTS veriora.customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    TEXT,
  preferred_name  TEXT,
  nickname        TEXT,
  real_name       TEXT,
  email           TEXT,
  phone           TEXT,
  company_name    TEXT,
  memo            TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  tags            TEXT[] NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE veriora.customers IS
  'Veliora 横断の共通顧客マスター。LINE userId は customer_identities 経由。';

CREATE TABLE IF NOT EXISTS veriora.customer_identities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES veriora.customers (id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  channel_key           TEXT NOT NULL,
  agent_key             TEXT,
  external_user_id      TEXT NOT NULL,
  external_display_name TEXT,
  external_picture_url  TEXT,
  raw_profile           JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified              BOOLEAN NOT NULL DEFAULT false,
  linked_by             TEXT NOT NULL DEFAULT 'auto',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_customer_identities_provider_channel_external
    UNIQUE (provider, channel_key, external_user_id)
);

COMMENT ON TABLE veriora.customer_identities IS
  '公式LINE・外部IDと customers の紐づけ（channel ごとに external_user_id は別）。';

CREATE TABLE IF NOT EXISTS veriora.customer_merge_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id_a   UUID NOT NULL REFERENCES veriora.customers (id) ON DELETE CASCADE,
  customer_id_b   UUID NOT NULL REFERENCES veriora.customers (id) ON DELETE CASCADE,
  reason          TEXT,
  score           NUMERIC,
  status          TEXT NOT NULL DEFAULT 'pending',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_merge_candidates_distinct CHECK (customer_id_a <> customer_id_b)
);

COMMENT ON TABLE veriora.customer_merge_candidates IS
  '同一人物の候補。自動 merge せず pending で保持。';

ALTER TABLE veriora.conversations
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES veriora.customers (id) ON DELETE SET NULL;

COMMENT ON COLUMN veriora.conversations.customer_id IS
  '共通顧客（任意）。link テーブルと併用可。';

DROP TRIGGER IF EXISTS trg_veriora_customers_updated ON veriora.customers;
CREATE TRIGGER trg_veriora_customers_updated
  BEFORE UPDATE ON veriora.customers
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();

DROP TRIGGER IF EXISTS trg_veriora_customer_identities_updated ON veriora.customer_identities;
CREATE TRIGGER trg_veriora_customer_identities_updated
  BEFORE UPDATE ON veriora.customer_identities
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();

DROP TRIGGER IF EXISTS trg_veriora_customer_merge_candidates_updated ON veriora.customer_merge_candidates;
CREATE TRIGGER trg_veriora_customer_merge_candidates_updated
  BEFORE UPDATE ON veriora.customer_merge_candidates
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();
