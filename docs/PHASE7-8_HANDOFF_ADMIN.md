# Phase 7–8: LRAM 取次ぎと管理 API 統一

## Phase 7 — NEAR → LRAM 取次ぎ

1. Render（または .env）に **同一の** `VERIORA_HANDOFF_SECRET`（12文字以上）を NEAR と LRAM に設定
2. NEAR に `NEAR_LRAM_BASE_URL=https://<lram-service>.onrender.com` を設定
3. ユーザー発話が LRAM 向けキーワード（BRAVO / 記事 / WordPress 等）にマッチすると:
   - `veriora.agent_handoff_logs` に記録（既存）
   - `POST {NEAR_LRAM_BASE_URL}/internal/handoff/near` を best-effort 実行

LRAM は監査ログ（`insertLog`）のみ。LINE 返信は引き続き NEAR が担当。

## Phase 8 — 統一 LINE 履歴（管理 API）

| サービス | エンドポイント | 認証 |
|----------|----------------|------|
| NEAR | `GET /admin/veliora/line-messages` | `ADMIN_API_KEY` |
| SERA | `GET /admin/veliora/line-messages` | `SERA_ADMIN_API_KEY` |
| LRAM | `GET /admin/veliora/line-messages` | `ADMIN_API_KEY` |

共通クエリ: `agent_code`, `line_user_id`, `group_id`, `conversation_key`, `direction`, `limit`  
データソース: VIEW `veliora.line_messages`（`veriora.messages` + 未ミラー legacy）

SERA のみ: `include_legacy_inbound=true` で `sera.sera_inbound_messages` も含める。

## 例

```bash
# NEAR 横断履歴
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://<near>/admin/veliora/line-messages?agent_code=near&limit=20"

# LRAM
curl -sS -H "Authorization: Bearer $LRAM_ADMIN_API_KEY" \
  "https://<lram>/admin/veliora/line-messages?agent_code=lram&limit=20"
```
