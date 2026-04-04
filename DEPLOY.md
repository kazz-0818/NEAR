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

初回起動時に `ensureSchema()` が DB マイグレーション相当を流します。

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
