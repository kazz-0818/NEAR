-- Veriora: seed departments and agents (idempotent)

INSERT INTO veriora.agent_departments (department_key, name, description) VALUES
  ('secretary', '秘書部', 'NEAR — 総合窓口・秘書'),
  ('marketing', 'マーケ部', 'SERA — SNS・広告・マーケ'),
  ('accounting', '経理部', 'IRIE — 経理・数値'),
  ('ai_hr', 'AI人事部', 'RITS — 品質監査・改善'),
  ('editorial', '編集部', 'LRAM — BRAVO・WordPress')
ON CONFLICT (department_key) DO NOTHING;

INSERT INTO veriora.ai_agents (
  agent_key, code, kana, department, display_name, role, description, enabled
) VALUES
  (
    'near', 'NEAR', 'ニア', '秘書部', 'NEAR-ニア-『秘書部』',
    '総合窓口・秘書・タスク整理・指示受付',
    'Veriora の一次窓口。専門部署へ取次ぎ、未対応はログ化。',
    true
  ),
  (
    'sera', 'SERA', 'セラ', 'マーケ部', 'SERA-セラ-『マーケ部』',
    'SNS・広告・集客・マーケティング支援',
    'マーケ分析・提案。断定は検証可能な範囲に限定。',
    true
  ),
  (
    'irie', 'IRIE', 'イリ', '経理部', 'IRIE-イリ-『経理部』',
    '売上・経費・請求・入金・利益管理',
    'スプレッドシート正の経理支援。',
    true
  ),
  (
    'rits', 'RITS', 'リツ', 'AI人事部', 'RITS-リツ-『AI人事部』',
    '会話品質・役割遵守・改善指示作成',
    '全AIの監査・品質レビュー。',
    true
  ),
  (
    'lram', 'LRAM', 'ラム', '編集部', 'LRAM-ラム-『編集部』',
    'BRAVO編集・ファッション記事・WordPress下書き',
    '記事候補・生成・WP投稿履歴。',
    true
  )
ON CONFLICT (agent_key) DO UPDATE SET
  code = EXCLUDED.code,
  kana = EXCLUDED.kana,
  department = EXCLUDED.department,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  description = EXCLUDED.description,
  enabled = EXCLUDED.enabled,
  updated_at = now();

-- veliora.ai_agents に lram / rits が無い場合のみ追加（LINE FK 用レガシー）
INSERT INTO veliora.ai_agents (agent_code, display_name, parent_brand) VALUES
  ('rits', 'RITS', 'Veliora OS'),
  ('lram', 'LRAM', 'Veliora OS')
ON CONFLICT (agent_code) DO NOTHING;
