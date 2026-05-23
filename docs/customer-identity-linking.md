# LINE userId と共通 customer の紐づけ

## channel_key 一覧

| agent_key | channel_key |
|-----------|-------------|
| near | `near_line` |
| sera | `sera_line` |
| irie | `irie_line` |
| rits | `rits_line` |
| lram | `lram_line` |

## 新規保存フロー

```
LINE webhook
  → channel_key 判定
  → external_user_id = LINE userId
  → findCustomerByIdentity / create customers + identity
  → saveMessage（既存 veriora.messages）
  → linkConversationToCustomer
  → buildCustomerContextForAgent（応答前）
  → extractCustomerMemoryFromMessage（応答後・非同期）
```

## 接続状況（コード）

| リポ | 状態 |
|------|------|
| NEAR | `veliora_line_log` + `user_memory_service` |
| SERA | `veliora_line_log` + `index.ts` agent |
| LRAM | `handlers.ts` + `chat.ts` |
| RITS | `verioraCanonicalLog` |
| LIRA | `app/line_routes.py` + `app/services/customers/resolve.py` |

## 既存会話の backfill

[`068_veriora_customer_backfill_optional.sql`](../src/db/migrations/068_veriora_customer_backfill_optional.sql)  
本番適用前にステージングで件数確認。自動 merge は行いません。

## 手動 merge

`POST /admin/customer-merge`（NEAR、Bearer `ADMIN_API_KEY`）

```json
{
  "survivor_customer_id": "uuid-a",
  "merged_customer_id": "uuid-b",
  "candidate_id": "optional-candidate-uuid"
}
```
