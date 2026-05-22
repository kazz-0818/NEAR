# Veriora migration 実行手順

## ファイル一覧（NEAR `src/db/migrations/`）

| # | ファイル | 内容 |
|---|----------|------|
| 053 | `053_veriora_core_schema.sql` | schema, departments, ai_agents |
| 054 | `054_veriora_conversations_messages.sql` | conversations, messages |
| 055 | `055_veriora_routing_audit.sql` | routing, handoff, audit |
| 056 | `056_veriora_quality_improvement.sql` | quality, findings, tasks |
| 057 | `057_veriora_unsupported_compat.sql` | VIEW → near.* |
| 058 | `058_veriora_lram_article_tables.sql` | LRAM tables |
| 059 | `059_veriora_compatibility_views.sql` | compat VIEWs |
| 060 | `060_veriora_seed_agents.sql` | seed 5 agents |
| 061 | `061_veriora_backfill_messages_optional.sql` | line_events → messages |
| 062 | `062_security_hardening_public_api.sql` | RLS, security_invoker VIEWs |
| 063 | `063_simplify_unified_line_log.sql` | 統一 `veliora.line_messages`、public NEAR VIEW 削除 |
| 064 | `064_near_user_memory.sql` | ユーザー長期記憶テーブル |
| 065 | `065_veriora_customer_core_tables.sql` | ベガパンク: customers, identities, merge_candidates |
| 066 | `066_veriora_customer_memory_tables.sql` | profiles, memory_notes, agent_contexts, conversation_links |
| 067 | `067_veriora_customer_indexes_rls.sql` | 索引・RLS |
| 068 | `068_veriora_customer_backfill_optional.sql` | 既存会話の identity/link backfill（INSERT/UPDATE のみ） |

他リポジトリは **同一 SQL** を別連番で同梱（SERA `016`–`026` 等）。詳細は [`supabase-simplification.md`](supabase-simplification.md)。

## ローカル / staging

```bash
cd NEAR
npm run migrate   # または npm run dev で ensureSchema
```

## 本番前チェックリスト

- [ ] `DROP` / `DELETE` / `TRUNCATE` が含まれていないこと
- [ ] 共有 Supabase で NEAR を先に起動（`near` schema 前提の VIEW がある場合）
- [ ] 061 は行数が多い場合時間がかかる — 必要なら SQL Editor で分割実行
- [ ] 適用後: `SELECT COUNT(*) FROM veriora.ai_agents` = 5
- [ ] 適用後: `SELECT COUNT(*) FROM veriora.message_feed`（061 後）

## ロールバック

テーブル DROP は行わない設計のため、ロールバックは **新 schema を参照しない** アプリ設定に戻すのみ。
