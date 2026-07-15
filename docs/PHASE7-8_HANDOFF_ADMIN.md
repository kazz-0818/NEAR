# Phase 7–8: 管理 API 統一（LINE 履歴）

> **2026-07 更新**: NEAR→LRAM の HTTP 取次ぎ（`velioraHandoff` / `NEAR_LRAM_BASE_URL`）は削除済み。組織横断の総合窓口は将来 **CORE** が担う予定。

## 統一 LINE 履歴（管理 API）

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
