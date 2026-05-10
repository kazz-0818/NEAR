-- help_capabilities 一覧に GitHub Issue 自動作成の案内を追加（未投入環境との整合）

INSERT INTO capability_registry (intent_name, module_path, description, user_visible_line, sort_order)
SELECT 'growth_github_issue_help_note', NULL, 'Growth GitHub Issue 案内', 'GitHub Issue自動作成に対応しました。', 55
WHERE NOT EXISTS (
  SELECT 1 FROM capability_registry WHERE intent_name = 'growth_github_issue_help_note'
);
