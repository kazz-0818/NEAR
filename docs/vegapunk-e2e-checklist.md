# ベガパンク計画 — 実LINE E2E 確認チェックリスト（Phase 3）

本番 LINE への**大量送信は禁止**。検証用アカウントから **1〜2通** のみ送り、以降は管理 API / SQL（読取のみ）で確認する。

## 前提

| 項目 | 値 |
|------|-----|
| 顧客マスター | `VERIORA_CUSTOMER_MASTER_ENABLED=true`（検証時のみ。緊急時は `false`） |
| 管理 API | NEAR `ADMIN_API_KEY` を Bearer に設定 |
| NEAR 管理 UI | `https://<near-host>/admin/ui` |
| 監査レポート | RITS `VERIORA_CUSTOMER_AUDIT_IN_DAILY_REPORT=true` |

## 1. 実LINE でメッセージ送信（最小）

1. **NEAR** 公式 LINE に 1 通（例: 「テスト」）
2. **SERA** 公式 LINE に 1 通（**別の** LINE アカウント推奨。同一アカウントでも可だが merge 候補は出にくい）

両方で **同じ display_name**（LINE プロフィール名）にしておくと merge 候補が出やすい。

## 2. identity 作成確認

```bash
export NEAR_BASE="https://<near-host>"
export ADMIN_API_KEY="<your-admin-key>"

# NEAR LINE
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  "$NEAR_BASE/admin/customers/by-identity?provider=line&channel_key=near_line&external_user_id=<LINE_USER_ID>"

# SERA LINE
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  "$NEAR_BASE/admin/customers/by-identity?provider=line&channel_key=sera_line&external_user_id=<SERA_LINE_USER_ID>"
```

期待:

- 両方 `found: true`
- **customer.id が異なる**（別 customer として作成）

## 3. merge 候補

```bash
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  "$NEAR_BASE/admin/customer-merge-candidates?status=pending"
```

期待: display_name 一致などで **pending** 候補が 1 件以上（無い場合は管理 UI で手動候補登録はしない — 別アカウント・同名で再試行）

## 4. 手動 merge

管理 UI `/admin/ui` → 顧客詳細 / merge 候補 → **承認＋merge**、または:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"survivor_customer_id":"<SURVIVOR_UUID>","merged_customer_id":"<MERGED_UUID>","candidate_id":"<CANDIDATE_UUID>"}' \
  "$NEAR_BASE/admin/customer-merge"
```

期待:

- merged 側 identity が survivor に集約
- `GET /admin/customers/<survivor_id>/identities` に near_line + sera_line が両方ある

## 5. SERA memory → NEAR / LRAM context

1. SERA LINE で嗜好メモが付く会話を 1 通（または管理 UI で `customer_memory_notes` を SERA 由来で追加）
2. NEAR LINE で同 survivor のユーザーとして 1 通
3. LRAM LINE で同 survivor として 1 通（記事依頼でなく雑談でも可）

確認:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  "$NEAR_BASE/admin/customers/<SURVIVOR_UUID>"
```

`memories` に SERA 由来 note。NEAR 応答ログまたは DB の `customer_agent_contexts` で near / lram に要約が載ること。

## 6. RITS 日次レポート（読取のみ）

RITS の日次レポート出力に **顧客マスター監査** 節があること（merge/削除は RITS が行わない）。

環境: `VERIORA_CUSTOMER_AUDIT_IN_DAILY_REPORT=true`

## 7. 緊急 OFF

```bash
# Render 等で VERIORA_CUSTOMER_MASTER_ENABLED=false に設定後
```

1. NEAR / SERA / LRAM の LINE に 1 通ずつ → **通常応答が返る**
2. 管理 UI / `GET /admin/customers` は引き続き利用可（読取・手動運用）

## 8. LIRA 非LINE（任意）

```bash
curl -sS -X POST "https://<lira-host>/ask" \
  -H "Content-Type: application/json" \
  -d '{"question":"今月の売上は？","manual_customer_id":"<SURVIVOR_UUID>"}'
```

期待: レスポンスに `customer_id`（紐づけ時のみ）。ID 無しの body では **新規 customer を作らない**。

## 9. 禁止事項（再掲）

- 本番での大量 LINE 送信
- 自動 merge
- DROP / TRUNCATE / 大量 DELETE

## 関連

- Phase 2 自動検証: `npm run vegapunk:verify`（`VEGAPUNK_VERIFY_ACK=1` 必須・staging 向け）
- 管理 UI: `/admin/ui`
- 計画: `docs/vegapunk-plan.md`
