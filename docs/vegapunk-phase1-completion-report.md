# ベガパンク Phase 1 — 共通顧客マスター 完了レポート

**実施日**: 2026-06-15（JST）  
**正典**: NEAR `docs/`・`src/db/migrations/065–068`  
**静的検証**: `npm run verify:vegapunk-static` → **52/52 OK**（DB 不要）

---

## 1. 変更一覧（要約）

| 領域 | 内容 |
|------|------|
| DB | `veriora.customers` / identities / profiles / memory_notes / merge_candidates / agent_contexts / conversation_links |
| NEAR | repositories・`services/customers/*`・LINE adapter・`near_user_memory` dual-read |
| 他部署 | SERA / LRAM / RITS（TS）・LIRA（Python）に migration 同梱 + line resolve / context |
| 管理 | NEAR `GET/POST /admin/customers*`（Bearer）・管理 UI `/admin/ui`（Phase 3 以降） |
| RITS | `customerAuditQueries.ts`・日次レポート顧客監査節（env） |

## 2. Migration 一覧

| NEAR | 他リポ同梱 |
|------|------------|
| `065_veriora_customer_core_tables.sql` | SERA 027 / LIRA 013 / RITS 019 / LRAM 015 |
| `066_veriora_customer_memory_tables.sql` | SERA 028 / LIRA 014 / RITS 020 / LRAM 016 |
| `067_veriora_customer_indexes_rls.sql` | SERA 029 / LIRA 015 / RITS 021 / LRAM 017 |
| `068_veriora_customer_backfill_optional.sql` | SERA 030 / LIRA 016 / RITS 022 / LRAM 018 |

`ensureSchema.ts` に 065–068 登録済み。DROP / TRUNCATE / 破壊的 DELETE なし。

## 3. Repository / ドメイン API

**`src/services/supabase/repositories/`**（7 ファイル）  
customers, customerIdentities, customerProfiles, customerMemoryNotes, customerAgentContexts, customerConversationLinks, customerMergeCandidates

**`src/services/customers/`**  
types, customerRepository, memoryRepository, identityRepository, contextBuilder, memoryExtractor, mergeCandidates, lineResolve, mergeSuggestions, adminAuditSummary

必須 API はすべて実装済み（`findCustomerByIdentity`, `createCustomer`, `upsertCustomerIdentity`, `resolveCustomerFromLineProfile`, `linkConversationToCustomer`, `buildCustomerContextForAgent`, merge 手動のみ 等）。

## 4. フロー（保存）

```
LINE webhook → channel_key → resolveCustomerFromLineProfile
  → upsert identity → linkConversationToCustomer
  → saveMessage（既存）
  → buildCustomerContextForAgent（応答前）
  → extractCustomerMemoryFromMessage（応答後・non-fatal）
```

`VERIORA_CUSTOMER_MASTER_ENABLED=false` 時は legacy `near_user_memory` のみ（LINE 応答は継続）。

## 5. 未接続・TODO（意図的）

- LIRA: 会話保存の全面 TS パリティは未（`app/customers/resolve.py` で resolve + context）
- 表示名のみの **自動 merge 禁止**（候補は `customer_merge_candidates` + 管理 API）
- `near.near_user_memory` の DROP / 一括移行 DELETE は行わない

詳細: [`customer-identity-linking.md`](customer-identity-linking.md)

## 6. 動作確認

| コマンド | 結果 |
|----------|------|
| `npm run build` | OK |
| `npm test` | OK（106+ tests） |
| `npm run verify:vegapunk-static` | 52/52 |
| `npm run verify:veriora-sync` | migration 065–068 ハッシュ一致 |
| `npx tsx scripts/vegapunk-phase2-verify.ts` | **要** `VEGAPUNK_VERIFY_ACK=1` + staging `DATABASE_URL` |

E2E 手順: [`vegapunk-e2e-checklist.md`](vegapunk-e2e-checklist.md)

## 7. 注意点

- 本番 migration は [`migration-plan.md`](migration-plan.md) の手順で検証後に適用
- 秘密（`DATABASE_URL` / service role）はコミット・レポートに含めない
- RLS: 新表は `veriora` + service_role 前提（anon ポリシー追加なし）
- 緊急 OFF: `VERIORA_CUSTOMER_MASTER_ENABLED=false`

## 8–15. 依頼 15 項目チェックリスト

1. **customers + identities** — migration 065 ✓  
2. **profiles + memory_notes** — migration 066 ✓  
3. **merge_candidates 手動のみ** — `mergeCustomersManual` ✓  
4. **conversation_links + conversations.customer_id** — 065 ✓  
5. **NEAR LINE 接続** — veliora_line_log + orchestrator ✓  
6. **SERA / LRAM LINE 接続** — index / handlers ✓  
7. **LIRA resolve** — `app/customers/` ✓  
8. **RITS 監査読取** — `customerAuditQueries` ✓  
9. **LRAM 記事 context** — workflowDraft + customerIdeaRank ✓  
10. **near_user_memory 併存** — dual-read / dual-write ✓  
11. **管理 API** — `customerRoutes.ts` ✓  
12. **4 ドキュメント** — vegapunk-plan + design + linking + memory-policy ✓  
13. **migration-plan / veriora.meta** — 追記済み ✓  
14. **5 リポ migration 同梱** — verify:vegapunk-static ✓  
15. **自動 merge なし・破壊的操作なし** — 設計どおり ✓  

---

*Phase 2 以降（管理 UI・E2E・merge 通知）は [`vegapunk-plan.md`](vegapunk-plan.md) Phase 3–4 を参照。*
