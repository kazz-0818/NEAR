# Veriora — Supabase / Postgres スキーマ

正典は **`veriora` schema**（UUID ベース）。レガシー **`veliora` schema**（LINE イベント・text `agent_code`）は削除せず併存します。

## エージェントマスタ

| テーブル | 説明 |
|----------|------|
| `veriora.ai_agents` | 正規マスタ。`agent_key` = registry の `id`（小文字） |
| `veriora.agent_departments` | 部署マスタ |
| `veliora.ai_agents` | レガシー（`line_message_events` FK 用） |

## 会話・メッセージ

| テーブル | 説明 |
|----------|------|
| `veriora.conversations` | スレッド。`conversation_key` は Veliora 形式と互換 |
| `veriora.messages` | 全エージェント共通メッセージ。RITS 監査の正 |

読取 VIEW: `veriora.message_feed`, `veriora.line_events_compat`

## ルーティング・監査

- `veriora.agent_routing_logs`
- `veriora.agent_handoff_logs`
- `veriora.agent_audit_logs`

## RITS 品質

- `veriora.agent_quality_reviews`
- `veriora.agent_quality_findings`
- `veriora.agent_improvement_tasks`

読取: `veriora.rits_agent_logs_compat` → `public.agent_logs`

## 未対応・提案（VIEW）

- `veriora.unsupported_requests` → `near.near_unsupported_requests`
- `veriora.implementation_suggestions` → `near.near_implementation_suggestions`

## LRAM 編集

- `veriora.lram_article_sources`
- `veriora.lram_article_candidates`
- `veriora.lram_generated_articles`
- `veriora.lram_wp_posts`

レガシー: `public.lram_*`（VIEW `veriora.lram_*_compat`）

## 既存テーブル対応表

| 既存 | 正規 / 互換 |
|------|-------------|
| `veliora.line_message_events` | `veriora.messages`（backfill `061`） |
| `near.near_inbound_messages` | 既存維持 + Veliora 二重記録 |
| `sera.sera_inbound_messages` | 同上 |
| `lira.lira_audit_log` | `veriora.agent_audit_logs`（任意 adapter） |
| `public.agent_logs` (RITS) | `veriora.rits_agent_logs_compat` |

## RLS

新規 `veriora.*` テーブルは RLS 有効。**サーバーは `service_role` / postgres 接続**想定。既存 RLS ポリシーは変更していません。

## コードからの利用

- TypeScript: `src/services/supabase/repositories/*`
- デュアル書き込み: `VERIORA_CORE_DUAL_WRITE=true`（NEAR LINE ログ）

## migration

[`migration-plan.md`](migration-plan.md) を参照。NEAR: `053`–`061`。
