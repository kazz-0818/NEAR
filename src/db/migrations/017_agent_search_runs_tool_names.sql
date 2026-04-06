-- agent_search_runs: 付与判定時点のカスタム関数ツール名一覧（監査用）

ALTER TABLE agent_search_runs ADD COLUMN IF NOT EXISTS tool_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
