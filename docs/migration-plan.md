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

他リポジトリは **同一 SQL** を別連番で同梱（SERA `016`–`024` 等）。

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
