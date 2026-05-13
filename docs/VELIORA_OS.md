# Veliora OS（Supabase / Postgres）統一ガイド

親ブランド **Veliora OS** 配下で、NEAR / SERA などの AI 部署（`veliora.ai_agents`）ごとに LINE 履歴を **`veliora.line_message_events`** に二重記録します。既存の `near.near_inbound_messages` / `sera.sera_inbound_messages` は従来どおり更新され、削除していません。

## 1. Supabase で実行する SQL（手動の場合）

通常は **NEAR または SERA を起動**すると `ensureSchema` がマイグレーションを適用します。

手動で流す場合は、次のファイルと同等の SQL を SQL Editor で実行してください。

- NEAR: `src/db/migrations/046_veliora_os.sql` および **`047_near_repair_public_stragglers.sql`**（`public` に残った NEAR 用テーブルを `near` スキーマへ寄せる冪等リペア。Supabase Table Editor のスキーマ＝フォルダ表示用）
- SERA: `src/db/migrations/010_veliora_os.sql`（046 と同一 DDL）＋ `011_sera_inbound_group_id.sql`

**推奨順序**

1. 先に **NEAR のマイグレーション 045 まで**が適用済みであること（`near` スキーマと `near_unsupported_requests` 等が存在すること）。
2. `046_veliora_os.sql` を実行（または NEAR を一度起動）。
3. SERA を起動すると `010` は冪等、`011` で `sera_inbound_messages.group_id` が追加される。

SERA の DB に **NEAR の `near` スキーマが無い**場合、`010` / `046` 内の

`CREATE VIEW veliora.unsupported_requests AS SELECT * FROM near.near_unsupported_requests`

が失敗します。その場合は当該 VIEW 定義をコメントアウトするか、NEAR を同じプロジェクトに先にデプロイしてください。

## 2. 環境変数

| 変数 | 用途 |
|------|------|
| `DATABASE_URL` | 従来どおり。Postgres（Supabase Pooler URI 可）。 |
| `ADMIN_API_KEY`（NEAR） | `/admin/*` および `/admin/veliora/*` |
| `SERA_ADMIN_API_KEY`（SERA） | `/admin/veliora/*` および既存の `/admin/meta-connection` 等 |

`SUPABASE_URL` / `SUPABASE_ANON_KEY` は本リポジトリでは未使用（`pg` + `DATABASE_URL`）。

## 3. 動作確認手順

1. **マイグレーション適用**: ローカルで `npm run dev`（NEAR / SERA それぞれ）を一度起動し、ログに `046_veliora_os` / `010_veliora_os` / `011_sera_inbound_group_id` が適用されたことを確認。
2. **AI マスタ**:  
   `curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" "$BASE/admin/veliora/ai-agents"`  
   （SERA ホストの場合は `SERA_ADMIN_API_KEY` と `/admin/veliora/ai-agents`）
3. **LINE 送信後**:  
   `curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" "$BASE/admin/veliora/line-messages?agent_code=near&limit=5"`  
   新着に `direction` / `conversation_key` / `legacy_table` が付いていること。
4. **既存 API**:  
   `GET /admin/inbound`（NEAR）が従来どおり 200 であること。

## 4. API 一覧（履歴・未対応）

### LINE 履歴（Veliora 統一）

- **NEAR**: `GET /admin/veliora/line-messages`（Bearer `ADMIN_API_KEY`）  
  Query: `agent_code`, `line_user_id`, `group_id`, `conversation_key`, `direction`, `limit`
- **SERA**: `GET /admin/veliora/line-messages`（Bearer `SERA_ADMIN_API_KEY`、12 文字以上）

### NEAR 専用（従来）

- `GET /admin/inbound` — NEAR の `near_inbound_messages` のみ。

### 未対応依頼（NEAR 実体、Veliora ビュー経由も可）

- `GET /admin/unsupported` — 従来どおり `near_unsupported_requests`。
- `GET /admin/veliora/unsupported-requests` — `veliora.unsupported_requests` ビュー（中身は `near.near_unsupported_requests`）。

## 5. 会話キー仕様

`conversation_key` は TypeScript の `buildVelioraConversationKey` と一致:

- DM: `{agent_code}:{channel}:dm:{line_user_id}`
- グループ: `{agent_code}:{channel}:group:{group_id}`

## 6. 注意点

- Veliora ログ書き込み失敗時も **LINE 本処理は継続**（警告ログのみ）。
- SERA の返信本文は従来どおり **DB には保存しない**が、**`veliora.line_message_events` には outbound として記録**する（`legacy_table = 'sera_ephemeral_outbound'`）。
- RLS を Veliora テーブルに新規で有効化していない（サーバー接続の postgres ロール利用想定）。
