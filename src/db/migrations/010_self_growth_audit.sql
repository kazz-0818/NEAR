-- 自己成長型 NEAR: 観測・監査用の列と実行ログ（既存フローはそのまま）

ALTER TABLE unsupported_requests
  ADD COLUMN IF NOT EXISTS request_mode_guess TEXT,
  ADD COLUMN IF NOT EXISTS gap_type TEXT,
  ADD COLUMN IF NOT EXISTS self_eval_json JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN unsupported_requests.request_mode_guess IS '秘書レイヤー等が推定した request_mode（分析用スナップショット）';
COMMENT ON COLUMN unsupported_requests.gap_type IS '不足分類: prompt_tune|routing_improvement|new_module|external_integration|auth_required|knowledge_missing|out_of_scope|unknown 等';
COMMENT ON COLUMN unsupported_requests.self_eval_json IS 'self_capability_evaluator 相当の構造化メモ（任意）';

-- improvement_kind と gap_type の初期同期（既存行）
UPDATE unsupported_requests
SET gap_type = improvement_kind
WHERE gap_type IS NULL AND improvement_kind IS NOT NULL AND btrim(improvement_kind) <> '';

ALTER TABLE capability_registry
  ADD COLUMN IF NOT EXISTS request_mode TEXT,
  ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT '1';

COMMENT ON COLUMN capability_registry.request_mode IS '任意: intent と別軸の request_mode 表示用';
COMMENT ON COLUMN capability_registry.version IS '能力の版（成長完了時にインクリメント等）';

CREATE TABLE IF NOT EXISTS growth_execution_log (
  id BIGSERIAL PRIMARY KEY,
  suggestion_id BIGINT NOT NULL REFERENCES implementation_suggestions (id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_execution_suggestion
  ON growth_execution_log (suggestion_id, created_at DESC);
