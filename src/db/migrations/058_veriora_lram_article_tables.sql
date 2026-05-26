-- Veliora: LRAM editorial workflow (canonical). Legacy public.lram_* tables remain.

CREATE TABLE IF NOT EXISTS veriora.lram_article_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url   TEXT NOT NULL,
  source_site  TEXT,
  source_title TEXT,
  brand_name   TEXT,
  category     TEXT,
  fetched_at   TIMESTAMPTZ,
  raw_summary  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_lram_sources_url ON veriora.lram_article_sources (source_url);
CREATE INDEX IF NOT EXISTS idx_veriora_lram_sources_created ON veriora.lram_article_sources (created_at DESC);

CREATE TABLE IF NOT EXISTS veriora.lram_article_candidates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        UUID REFERENCES veriora.lram_article_sources (id) ON DELETE SET NULL,
  agent_id         UUID REFERENCES veriora.ai_agents (id) ON DELETE SET NULL,
  title_candidate  TEXT,
  angle            TEXT,
  facts            JSONB NOT NULL DEFAULT '{}'::jsonb,
  bravo_viewpoint  TEXT,
  status           TEXT NOT NULL DEFAULT 'candidate',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_lram_candidates_status
  ON veriora.lram_article_candidates (status, created_at DESC);

DROP TRIGGER IF EXISTS trg_veriora_lram_candidates_updated ON veriora.lram_article_candidates;
CREATE TRIGGER trg_veriora_lram_candidates_updated
  BEFORE UPDATE ON veriora.lram_article_candidates
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();

CREATE TABLE IF NOT EXISTS veriora.lram_generated_articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID REFERENCES veriora.lram_article_candidates (id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  slug          TEXT,
  excerpt       TEXT,
  content       TEXT NOT NULL,
  image_prompt  TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  categories    TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'draft',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_lram_generated_status
  ON veriora.lram_generated_articles (status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_veriora_lram_generated_updated ON veriora.lram_generated_articles;
CREATE TRIGGER trg_veriora_lram_generated_updated
  BEFORE UPDATE ON veriora.lram_generated_articles
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();

CREATE TABLE IF NOT EXISTS veriora.lram_wp_posts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_article_id  UUID REFERENCES veriora.lram_generated_articles (id) ON DELETE SET NULL,
  wp_post_id            TEXT,
  wp_post_url           TEXT,
  wp_status             TEXT,
  posted_at             TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_lram_wp_posts_article
  ON veriora.lram_wp_posts (generated_article_id);

ALTER TABLE veriora.lram_article_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE veriora.lram_article_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE veriora.lram_generated_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE veriora.lram_wp_posts ENABLE ROW LEVEL SECURITY;
