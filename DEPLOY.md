# NEAR デプロイ手順

このリポジトリは **Docker** でビルドできます。PaaS のダッシュボードに **環境変数** をそのまま登録してください（`.env` は Git に含めない）。

## 必要な環境変数

`.env.example` と同じキーが必要です。本番では少なくとも次を設定します。

| 変数 | 説明 |
|------|------|
| `DATABASE_URL` | Supabase の Pooler URI 推奨（本番も IPv4 のことが多い） |
| `LINE_CHANNEL_SECRET` | LINE Developers |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers |
| `OPENAI_API_KEY` | OpenAI |
| `ADMIN_API_KEY` | 長いランダム文字列（管理 API 用） |
| `PORT` | 未設定なら `3000`。Render 等が自動で付与する場合はそのまま |
| `CRON_SECRET` | 任意（`/internal/reminders/dispatch` を保護する場合） |
| `ADMIN_LINE_USER_ID` | 任意。**成長フロー**で管理者へ第一段階承認・ヒアリング・最終承認・実装指示・進捗を LINE プッシュ（あなたの userId を設定） |
| `GROWTH_AUTO_CODING_ENABLED` | 任意 `true`/`1`。自動コーディング runner（**未接続時はスタブ**で手動運用推奨） |
| `GROWTH_AUTO_DEPLOY_ENABLED` | 任意 `true`/`1`。自動デプロイ runner（**未接続時はスタブ**。本番は既定オフ推奨） |
| `GROWTH_SUGGESTION_GATE_ENABLED` | 任意 `false`/`0` で無効＝**毎回** suggestion。有効時（既定）はルール通過時だけ suggestion（[`growth_suggestion_gate`](src/services/growth_suggestion_gate.ts)） |
| `GROWTH_SKIP_OUT_OF_SCOPE` | 既定オン相当。`false` で `out_of_scope` も提案対象に |
| `GROWTH_SKIP_WHEN_FOLLOWUP` | 既定オン相当。`needs_followup` 時は suggestion 保留 |
| `GROWTH_MIN_MESSAGE_CHARS` | 既定 `12`。未満はログのみ（`growth_skipped`）。`0` で無効 |
| `GROWTH_MIN_FINGERPRINT_COUNT` | 既定 `2`。同一 fingerprint の件数が足りるまで保留（`1` で従来に近い） |
| `GROWTH_MIN_CONFIDENCE_UNKNOWN` | 既定 `0.35`。`unknown_custom_request` かつ低 confidence はスキップ。`0` で無効 |
| `PUBLIC_BASE_URL` | 任意。上記通知に `…/admin/suggestions/:id` のリンクを載せるとき（例: `https://near-xxx.onrender.com`、末尾スラッシュなし） |
| `LINE_BOT_USER_ID` | 任意。グループ／トークルームでは **@ボットのメンション** か **本文に「NEAR」「ニア」** がないと返信しない（1:1 は従来どおり）。メンション判定に使う。`curl -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" https://api.line.me/v2/bot/info` の `userId` |
| `NEAR_WHATS_NEW` | 任意。改行可。「最近できるようになったこと」を NEAR が短く話すときの本文（デプロイごとに手更新） |

初回起動時に `ensureSchema()` が DB マイグレーション相当を流します（`001`〜`003_growth_flow.sql`）。

## NEAR 成長システム（運用の流れ）

1. ユーザーが未対応依頼をすると `unsupported_requests` に保存されます。条件を満たすときだけ非同期で `implementation_suggestions` が作られ管理者へ通知されます。弾かれた行は `status=growth_skipped` と `notes` に理由が残ります（[`growth_suggestion_gate.ts`](src/services/growth_suggestion_gate.ts)）。
2. `ADMIN_LINE_USER_ID` があると、管理者の LINE に**第一段階承認**（この成長候補で進めてよいか）が届きます。`growth_admin_sessions` でアクティブな提案が紐づきます。
3. 管理者は LINE で「はい／いいえ」→**ヒアリング**（1問ずつ）→**第二承認**→**Cursor 向け指示の再生成＋プッシュ**、の順で進めます。メッセージ例: 進行中は `テスト完了`→`デプロイ準備OK`→実装後 `成長完了`（または管理 API の `complete`）。
4. 管理 API（`Authorization: Bearer <ADMIN_API_KEY>`）の例:
   - `GET /admin/suggestions?status=pending` … 第一段階 `approval_status` フィルタ
   - `GET /admin/suggestions/:id` … 1件
   - `GET /admin/suggestions/:id/hearing` … ヒアリング Q&A
   - `PATCH /admin/suggestions/:id` … `approval_status`（`pending`→`approved`|`rejected`）、`implementation_state`、`deploy_safety_confirmed`（`deploying` へ進むとき必須）、`failure_reason` / `review_notes`
   - `POST /admin/suggestions/:id/growth/second-approve` … 第二承認相当（LINE と同じ処理）
   - `POST /admin/suggestions/:id/growth/complete` … 成長完了（`capability_registry` 追記・通知）
5. **自動コーディング／自動デプロイ**は `coding_runner` / `deploy_runner` のアダプタ差し替えで拡張します。フラグオンでも未接続ならスタブが返るだけです。

設計メモはリポジトリ内 `GROWTH.md` を参照してください。

## LINE Webhook

デプロイ後に表示される **`https://<あなたのホスト>/webhook/line`** を LINE Developers の Webhook URL に設定し、検証してください。ngrok は不要になります。

---

## Render（例）

1. [Render](https://render.com) にログイン → **New +** → **Blueprint** または **Web Service**
2. GitHub リポジトリを接続（NEAR を push しておく）
3. **Docker** を選択し、ルートに `Dockerfile` があることを確認
4. **Environment** に上表の変数を追加
5. **Deploy**。URL が発行されたら LINE の Webhook を更新

`render.yaml` を使う場合は **Blueprint** からリポジトリを指定。

---

## Railway（例）

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. リポジトリ選択。`Dockerfile` を検出してビルド
3. サービス → **Variables** に環境変数を追加
4. **Settings → Networking → Generate Domain** で HTTPS URL を取得
5. Webhook URL を `https://<domain>/webhook/line` に設定

`railway.json` は Docker ビルド用の補助です。

---

## ローカルで Docker 試験

```bash
docker build -t near .
docker run --rm -p 3000:3000 --env-file .env near
```

`curl http://localhost:3000/health` で確認。
