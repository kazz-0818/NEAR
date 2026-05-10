-- NEAR Growth: GitHub Issue 自動作成（STEP1）用メタデータ

ALTER TABLE implementation_suggestions
  ADD COLUMN IF NOT EXISTS github_issue_url TEXT,
  ADD COLUMN IF NOT EXISTS github_issue_number INTEGER,
  ADD COLUMN IF NOT EXISTS github_issue_status TEXT,
  ADD COLUMN IF NOT EXISTS coding_status TEXT,
  ADD COLUMN IF NOT EXISTS coding_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS issue_created_at TIMESTAMPTZ;
