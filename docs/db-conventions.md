# Veriora — DB / テーブル命名規約

## 目的

- エージェント追加時に **テーブル名・schema が衝突しにくい**状態にする。
- **RITS** が全 AI の会話・監査にアクセスしやすい形を目指す（段階導入）。
- **LRAM** が WordPress 投稿履歴を保存できる拡張余地を残す。

## 基本ルール

1. **テーブル名・カラム名は `snake_case`**。
2. **既存テーブルは削除しない**。変更は **additive migration** と **VIEW による互換**を優先。
3. **エージェント固有の実テーブル**は、既存パターンに合わせる:
   - NEAR: `near` schema + `near_*` テーブル（例: `near.near_inbound_messages`）
   - SERA: `sera` schema + `sera_*` テーブル
4. **横断（組織共通）のログ・マスタ**は、既存の Postgres **`veliora` schema**（レガシー綴り）を現状の接続先とする。将来 **Veriora** 表記へ寄せる場合は **新 schema ではなく VIEW / synonym から着手**する（本 Phase では rename しない）。

## 既存の「正」となるオブジェクト（参照のみ）

- **Veliora OS（NEAR ドキュメント）**: `docs/VELIORA_OS.md` — `veliora.ai_agents`, `veliora.line_message_events`, `veliora.line_messages` VIEW 等。
- **NEAR 業務テーブル**: `near.*`（migration により `public` から移行済みの構成）。
- **SERA 業務テーブル**: `sera.*`。
- **RITS（Supabase `public`）**: `src/db/schema.sql` — `agent_profiles`, `agent_logs`, `agent_audits`, `unsupported_requests` 等。

## 将来の共通テーブル案（新規作成時の名前候補）

**実行はしない**。SQL は将来の migration 案としてのみ扱う。

| 候補名 | 役割 |
|--------|------|
| `ai_agents` | 既に `veliora.ai_agents` が存在。拡張時は **ALTER TABLE でカラム追加**を優先。 |
| `agent_departments` | 部署マスタ（正規化したくなった場合）。未作成。 |
| `conversations` | `conversation_key` 等の正規化用（未作成。現状は文字列キーで運用）。 |
| `messages` | `veliora.line_message_events` が実質メッセージストア。 |
| `agent_audit_logs` | RITS の `agent_audits` と統合・VIEW 化を検討。 |
| `agent_quality_reviews` | Phase 6 以降。 |
| `agent_quality_findings` | Phase 6 以降。 |
| `agent_improvement_tasks` | Phase 6 以降。 |
| `unsupported_requests` | NEAR 実体は `near.near_unsupported_requests`。Veliora VIEW `veliora.unsupported_requests`。**RITS の `public.unsupported_requests` と名前が衝突しうる**ため、統合時は **VIEW 名または schema を必ず分離**。 |
| `implementation_suggestions` | NEAR 実体 + Veliora VIEW。 |
| `lram_article_sources` | LRAM 用（将来）。 |
| `lram_article_candidates` | 同上 |
| `lram_generated_articles` | 同上 |
| `lram_wp_posts` | WordPress 投稿履歴（将来） |

## LIRA（現状）

- 監査: `public.lira_audit_log`（`docs/supabase.sql`）。**エージェント横断の会話テーブルは持たない**（Sheets 正）。

## RITS 監査との接続方針

1. **短期**: 各エージェントが RITS の `POST /admin/logs` に送る既存方式を維持（registry の `code` と `agent_name` の表記をそろえる運用）。
2. **中期**: `veliora.line_message_events` を **読み取りソース**として RITS が集計（直接 DB か、NEAR の admin API 経由は別設計）。
3. **長期**: `agent_logs` と Veliora ログの **VIEW 統合**または **ETL**。

## LRAM（WordPress）との接続方針

- 記事・下書き・メディアは **`lram_*` テーブル** または `lram` schema に集約する案を採用（未作成）。
- WP 本体は外部システムのため、**WP 側 ID・URL・revision** を Veriora DB に保存し、本文の正は WP またはオブジェクトストレージに任せる設計を推奨。

## migration 時の注意

- **冪等性**: `IF NOT EXISTS` / `CREATE OR REPLACE VIEW` を優先。
- **順序**: NEAR の `VELIORA_OS.md` にある推奨順（046 等）を踏襲。
- **SERA のみの DB** に NEAR の `near` schema が無い場合、VIEW 作成が失敗する点に注意（既知。ドキュメント済み）。

## RLS

- テーブルごとに **どのロールが書くか**（`service_role` のみ等）を一文で決める。
- `anon` からの insert を許す場合はポリシー必須（LIRA の `lira_audit_log` は参考例）。

## 削除禁止方針

- 既存の **業務テーブル行**をマイグレーションで消さない（アーカイブ列・別テーブル移動）。
- `near.*`, `sera.*`, `veliora.*` の DROP は **別途 RFC**。

## additive SQL 案（実行しない）

```sql
-- 例: ai_agents の拡張（将来）
-- ALTER TABLE veliora.ai_agents
--   ADD COLUMN IF NOT EXISTS department text,
--   ADD COLUMN IF NOT EXISTS registry jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 例: RITS agent_logs を veliora から参照する読み取り VIEW（名前衝突に注意）
-- CREATE OR REPLACE VIEW veliora.rits_agent_logs AS
--   SELECT * FROM public.agent_logs;
```

実際の本番適用前に、**staging で権限・検索パス・パフォーマンス**を検証すること。
