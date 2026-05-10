-- NEAR Growth v4: Growth 自動 PR の追跡（管理者 LINE「反映して」解決用）

ALTER TABLE implementation_suggestions
  ADD COLUMN IF NOT EXISTS github_growth_pr_url TEXT,
  ADD COLUMN IF NOT EXISTS github_growth_pr_number INTEGER;
