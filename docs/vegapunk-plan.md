# Veliora 版ベガパンク計画

## とは

**ベガパンク計画**は、NEAR / SERA / IRIE / RITS / LRAM が別々の LINE 公式アカウントで会話しても、裏側で **同じ顧客**としてプロフィール・好み・呼び名・重要メモを共有するための横断データ設計です。

## なぜ LINE userId だけでは不十分か

LINE の `userId` は **公式アカウント（チャネル）ごとに異なる**可能性があります。  
NEAR で話した人と SERA で話した人が同一人物でも、ID が違えば従来は別ユーザー扱いでした。

## 共通顧客マスターの考え方

| 層 | テーブル | 役割 |
|----|----------|------|
| 1 | `veriora.customers` | 組織横断の顧客 ID（UUID） |
| 2 | `veriora.customer_identities` | 各チャネルの外部 ID（LINE userId 等） |

例: 同一 `customers.id` に `near_line` と `sera_line` の別 userId を紐づけます。

## 各 AI が情報を共有する仕組み

- **プロフィール・メモ**: `customer_profiles`, `customer_memory_notes`（`source_agent_key` 付き）
- **部署別要約**: `customer_agent_contexts`（agent ごと 1 行）
- **会話**: `customer_conversation_links` + 既存 `veriora.conversations` / `messages`
- **応答前**: `buildCustomerContextForAgent(customerId, agentKey)` でプロンプト注入

SERA で得た confirmed 情報は、NEAR が同じ `customer_id` 経由で参照できます。

## 自動 merge しない理由

表示名の一致だけでは同一人物と断定しません。候補は `customer_merge_candidates` に `pending` で残し、**管理 API の手動 merge** または本人確認後に統合します。

## 記憶保存の方針

- ユーザーが明示した情報 → `confirmed=true`
- AI の推測 → `confirmed=false`、低 confidence
- 短期・雑談・センシティブは原則保存しない

詳細: [`customer-memory-policy.md`](customer-memory-policy.md)

## センシティブ情報

健康・宗教・政治・性的内容・詳細住所などは **原則保存しない**。保存が必要な場合は `is_sensitive=true` とし、プロンプトには載せない。

## RITS 監査との関係

RITS は `customer_id` 単位で identity・profiles・会話リンクを読み、部署間の矛盾や未確認情報の断定を監査します（[`customerAuditQueries`](../RITS/src/services/customerAuditQueries.ts)）。

## LRAM 編集部との関係

LRAM は顧客のブランド嗜好・事業情報を `buildCustomerContextForAgent(..., 'lram')` で記事生成前に参照します。

## NEAR 既存記憶との関係

`near.near_user_memory` は **削除しません**。`VERIORA_CUSTOMER_MASTER_ENABLED` 時は Veriora マスターを優先し、legacy はフォールバックします。

## Phase 4 で完了した運用面

- LRAM 記事ネタ一覧の顧客嗜好ソート（`rankArticleIdeasByCustomerContext`）
- merge 候補の管理者 LINE 通知（`VERIORA_MERGE_CANDIDATE_NOTIFY`、NEAR `/admin/ui` リンク）
- email / phone 一致による merge 候補（自動統合はしない）
- 管理 API `PATCH /admin/customers/:id`（email / phone）
- LIRA `POST /ask` の RITS ログ転送
- 静的検証: `npm run verify:vegapunk-phase4`

## 今後の拡張（Phase 5 以降）

- 実 LINE E2E の staging 自動化
- merge 候補の Slack 通知
- 記事ネタの LLM リランキング（ルールベースから段階移行）

## Phase 3 で完了した運用面

- 管理 UI（`/admin/ui`）と顧客管理 API
- LIRA `/ask` の customer resolve（外部 ID がある場合のみ）
- RITS 日次レポートの顧客監査節（`VERIORA_CUSTOMER_AUDIT_IN_DAILY_REPORT`）
- LRAM 記事下書きへの `buildCustomerContextForAgent`
- E2E 手順: [`vegapunk-e2e-checklist.md`](vegapunk-e2e-checklist.md)

関連: [`customer-master-design.md`](customer-master-design.md), [`customer-identity-linking.md`](customer-identity-linking.md)
