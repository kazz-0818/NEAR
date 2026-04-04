-- Growth flow: two-stage approval, hearing, implementation_state, capability_registry

-- unsupported_requests: 仕様どおりの列
ALTER TABLE unsupported_requests
  ADD COLUMN IF NOT EXISTS normalized_message TEXT,
  ADD COLUMN IF NOT EXISTS intent_guess TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE unsupported_requests
SET intent_guess = detected_intent
WHERE intent_guess IS NULL AND detected_intent IS NOT NULL;

UPDATE unsupported_requests
SET normalized_message = btrim(original_message)
WHERE normalized_message IS NULL OR normalized_message = '';

-- implementation_suggestions: new_modules → suggested_modules（冪等）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'implementation_suggestions'
      AND column_name = 'new_modules'
  ) THEN
    ALTER TABLE implementation_suggestions RENAME COLUMN new_modules TO suggested_modules;
  END IF;
END $$;

ALTER TABLE implementation_suggestions
  ADD COLUMN IF NOT EXISTS required_information JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS implementation_state TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS deploy_safety_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 旧 approval_status=implemented を implementation_state に移す
UPDATE implementation_suggestions
SET approval_status = 'approved',
    implementation_state = 'implemented',
    updated_at = now()
WHERE approval_status = 'implemented';

CREATE TABLE IF NOT EXISTS growth_admin_sessions (
  admin_line_user_id TEXT PRIMARY KEY,
  active_suggestion_id BIGINT REFERENCES implementation_suggestions (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_hearing_items (
  id BIGSERIAL PRIMARY KEY,
  implementation_suggestion_id BIGINT NOT NULL REFERENCES implementation_suggestions (id) ON DELETE CASCADE,
  sort_order INT NOT NULL,
  question_key TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answer_text TEXT,
  asked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  UNIQUE (implementation_suggestion_id, question_key)
);

CREATE INDEX IF NOT EXISTS idx_growth_hearing_suggestion
  ON growth_hearing_items (implementation_suggestion_id, sort_order);

CREATE TABLE IF NOT EXISTS capability_registry (
  id BIGSERIAL PRIMARY KEY,
  intent_name TEXT,
  module_path TEXT,
  description TEXT,
  user_visible_line TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_registry_intent_name
  ON capability_registry (intent_name)
  WHERE intent_name IS NOT NULL;

-- 既存の静的一覧に相当する初期行（未存在時のみ）
INSERT INTO capability_registry (intent_name, module_path, description, user_visible_line, sort_order)
SELECT v.*
FROM (
  VALUES
    ('task_create', 'src/modules/task_manager.ts', 'タスク記録', 'タスクの記録（やることリストに追加）', 10),
    ('memo_save', 'src/modules/memo_store.ts', 'メモ保存', 'メモの保存', 20),
    ('reminder_request', 'src/modules/reminder_manager.ts', 'リマインド', 'リマインドの受付（お時間の指定がはっきりしていると助かります）', 30),
    ('summarize', 'src/modules/summarizer.ts', '要約', '短い文章の要約・整理', 40),
    ('simple_question', 'src/modules/faq_answerer.ts', 'FAQ', '簡単な質問へのお答え（一般的な範囲）', 50),
    ('help_capabilities', 'src/modules/capabilities.ts', 'できること案内', 'NEARができることのご案内（今お送りしている内容です）', 60)
) AS v (intent_name, module_path, description, user_visible_line, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM capability_registry cr WHERE cr.intent_name = v.intent_name
);

INSERT INTO capability_registry (intent_name, module_path, description, user_visible_line, sort_order)
SELECT 'near_fallback_notice', NULL, 'フォールバック文案', 'その他のご依頼もお受けしますが、まだ対応できない場合は内容を記録し、できるよう改善してまいります。', 100
WHERE NOT EXISTS (
  SELECT 1 FROM capability_registry WHERE intent_name = 'near_fallback_notice'
);

CREATE INDEX IF NOT EXISTS idx_capability_registry_enabled_sort
  ON capability_registry (enabled, sort_order);
