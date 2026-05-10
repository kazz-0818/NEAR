-- 機能一覧（help / near_list_capabilities）に GitHub Issue 自動作成の案内を追加

INSERT INTO capability_registry (intent_name, module_path, description, user_visible_line, sort_order)
SELECT 'github_issue_automation', NULL, 'GitHub Issue 自動作成の案内', 'GitHub Issue自動作成に対応しました。', 55
WHERE NOT EXISTS (
  SELECT 1 FROM capability_registry WHERE intent_name = 'github_issue_automation'
);
