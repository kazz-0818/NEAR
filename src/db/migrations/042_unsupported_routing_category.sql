-- ルーティング分析用: unsupported 行の分類（既存 INSERT 互換のため NULL 可）

ALTER TABLE unsupported_requests
  ADD COLUMN IF NOT EXISTS routing_category TEXT;

COMMENT ON COLUMN unsupported_requests.routing_category IS
  '例: external_tool_needed, growth_candidate, unsupported_unknown（任意・分析用）';
