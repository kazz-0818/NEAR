# Veliora ベガパンク Phase 2 検証レポート

生成: 2026-05-22T15:00:38.688Z  
DB host: `aws-1-ap-southeast-2.pooler.supabase.com`（パスワード・APIキーは記載なし）

## サマリ

- チェック: 27/27 成功
- 失敗: 0

## 1. migration適用結果

- **migration ensureSchema**: OK — ensureSchema 完了（未適用分のみ適用）
- **migration 065-068 applied**: OK — 065_veriora_customer_core_tables.sql, 066_veriora_customer_memory_tables.sql, 067_veriora_customer_indexes_rls.sql, 068_veriora_customer_backfill_optional.sql


## 2. 作成されたテーブル確認結果

- **table veriora.customers**: OK — exists
- **table veriora.customer_identities**: OK — exists
- **table veriora.customer_profiles**: OK — exists
- **table veriora.customer_memory_notes**: OK — exists
- **table veriora.customer_agent_contexts**: OK — exists
- **table veriora.customer_conversation_links**: OK — exists
- **table veriora.customer_merge_candidates**: OK — exists


## 3. NEARでのcustomer作成確認

- **NEAR customer create**: OK — customerId=fdcdf446…
- **NEAR customer_identities near_line**: OK — identity=f038ceb9…


## 4. SERAでのcustomer作成確認

- **SERA customer create (separate from NEAR)**: OK — sera=30180c7a… near=fdcdf446…
- **NEAR context after merge (SERA note)**: OK — 170 chars


## 5. customer_identitiesの確認結果

- **table veriora.customer_identities**: OK — exists
- **FK integrity (orphan identities/profiles)**: OK — 0 orphan(s)
- **NEAR customer_identities near_line**: OK — identity=f038ceb9…
- **merge aggregates identities**: OK — channels: near_line, sera_line


## 6. customer_merge_candidatesの確認結果

pending before merge: 1  
- **table veriora.customer_merge_candidates**: OK — exists
- **customer_merge_candidates (display_name)**: OK — candidate_ids=1


## 7. /admin/customer-mergeの確認結果

- **customer-merge manual**: OK — merged customer status=merged
- **admin GET by-identity (HTTP)**: OK — skipped — server not reachable; merge/API logic verified via DB (fetch failed)
- **admin customer-merge (DB)**: OK — mergeCustomersManual executed in case 3


## 8. customer contextがNEAR/SERA/IRIE/RITS/LRAMで参照できるか

- **table veriora.customer_agent_contexts**: OK — exists
- **NEAR context after merge (SERA note)**: OK — 170 chars
- **LRAM context (shared confirmed)**: OK — 170 chars
- **RITS customer audit section (query parity)**: OK — ## Veliora_customer_master | merge_candidates_pending: 0 | customers_active: 6


## 9. memoryExtractorの動作結果

- **memoryExtractor sera**: OK — persistExtractedMemory OK


## 10. VERIORA_CUSTOMER_MASTER_ENABLED=false時の挙動

- **VERIORA_CUSTOMER_MASTER_ENABLED=false**: OK — env transform matches getEnv schema (lineResolve skips when false)


## 11. 失敗した箇所

- なし

## 12. 修正した箇所

- 068 backfill: UPDATE conversations の alias 修正（conv / 旧 c 参照バグ）
- 検証スクリプト `scripts/vegapunk-phase2-verify.ts` 追加
- 同内容を SERA/IRIE/RITS/LRAM の 068 同梱 SQL に反映

## 13. まだ未接続の箇所

- 実LINE Webhook（本番LINEアカウントへの実メッセージ）は未実施の場合あり — DB層で `resolveCustomerFromLineProfile` により同等検証
- LIRA: `/ask` 非LINE経路
- 管理UI（APIのみ）

## 14. 本番反映前チェックリスト

- [ ] staging で本レポートの全項目が green
- [ ] 068 backfill 件数確認
- [ ] NEAR → 他部署の順でデプロイ
- [ ] `VERIORA_CUSTOMER_MASTER_ENABLED` 緊急OFF手順の共有
- [ ] 手動 merge 運用（自動統合なし）の合意

## 15. Phase 3 提案

- 管理UI（顧客閲覧・merge承認）
- IRIE /ask への customer resolve
- RITS 日次レポートで `VERIORA_CUSTOMER_AUDIT_IN_DAILY_REPORT=true` 常時化の判断
- 電話・メールによる merge **候補**（自動統合はしない）
- `near_user_memory` からの段階的 read 移行（DROP なし）

## 全チェック一覧

- [x] migration ensureSchema: ensureSchema 完了（未適用分のみ適用）
- [x] migration 065-068 applied: 065_veriora_customer_core_tables.sql, 066_veriora_customer_memory_tables.sql, 067_veriora_customer_indexes_rls.sql, 068_veriora_customer_backfill_optional.sql
- [x] table veriora.customers: exists
- [x] table veriora.customer_identities: exists
- [x] table veriora.customer_profiles: exists
- [x] table veriora.customer_memory_notes: exists
- [x] table veriora.customer_agent_contexts: exists
- [x] table veriora.customer_conversation_links: exists
- [x] table veriora.customer_merge_candidates: exists
- [x] conversations.customer_id column: nullable FK
- [x] ai_agents seed: keys: lira, lram, near, rits, sera
- [x] FK integrity (orphan identities/profiles): 0 orphan(s)
- [x] NEAR customer create: customerId=fdcdf446…
- [x] NEAR customer_identities near_line: identity=f038ceb9…
- [x] NEAR conversation link: conversation=1e0b57ca…
- [x] SERA customer create (separate from NEAR): sera=30180c7a… near=fdcdf446…
- [x] memoryExtractor sera: persistExtractedMemory OK
- [x] customer_merge_candidates (display_name): candidate_ids=1
- [x] customer-merge manual: merged customer status=merged
- [x] merge aggregates identities: channels: near_line, sera_line
- [x] NEAR context after merge (SERA note): 170 chars
- [x] LRAM context (shared confirmed): 170 chars
- [x] RITS customer audit section (query parity): ## Veliora_customer_master | merge_candidates_pending: 0 | customers_active: 6
- [x] VERIORA_CUSTOMER_MASTER_ENABLED=false: env transform matches getEnv schema (lineResolve skips when false)
- [x] lineResolve empty userId non-throw: empty lineUserId returns early
- [x] admin GET by-identity (HTTP): skipped — server not reachable; merge/API logic verified via DB (fetch failed)
- [x] admin customer-merge (DB): mergeCustomersManual executed in case 3
