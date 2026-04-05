# NEAR（LINE × AI秘書）MVP

公式LINEを窓口に、OpenAI で意図判定し、モジュール実行または未対応ログ＋丁寧な返答を行います。設計思想・秘書レイヤー（request_mode）・ロードマップは [`docs/NEAR_SECRETARY_ARCHITECTURE.md`](docs/NEAR_SECRETARY_ARCHITECTURE.md) を参照してください。

## 必要な環境変数

[`.env.example`](.env.example) を参照し `.env` を作成してください。

## セットアップ

```bash
npm install
cp .env.example .env
# .env を編集
npm run migrate   # または初回起動時に ensureSchema が流れる
npm run dev
```

本番ビルド: `npm run build` のあと `npm start`。

### Supabase で `DATABASE_URL` が画面で見つからないとき

直結ホストは `db.<Project ID>.supabase.co` で固定です。DB パスワードが分かればターミナルで組み立てられます（**パスワードはチャットに貼らず、自分のターミナルだけで実行**）。

```bash
cd /Users/akaikazufumi/Downloads/NEAR
PGPASSWORD='（Supabase の Database パスワード）' npm run db:url
# 表示された DATABASE_URL=... を .env にコピー
PGPASSWORD='（同じ）' npm run db:test   # 接続確認
```

別プロジェクトのときは `SUPABASE_PROJECT_REF=xxxx` を前置します。

## エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/health` | ヘルスチェック |
| POST | `/webhook/line` | LINE Webhook（`X-Line-Signature` 必須） |
| * | `/admin/*` | 管理用 JSON API（`Authorization: Bearer <ADMIN_API_KEY>`） |
| POST | `/internal/reminders/dispatch` | リマインド手動実行（`CRON_SECRET` 設定時は `Authorization: Bearer <CRON_SECRET>`） |

## 管理 API 例

```bash
curl -s -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/admin/capabilities
curl -s -H "Authorization: Bearer $ADMIN_API_KEY" "http://localhost:3000/admin/stats/demand-ranking"
```

## ディレクトリ

- `src/modules/` … 実行モジュールと `registry.ts`
- `prompts/` … 意図判定・人格・実装提案プロンプト
- `src/db/migrations/` … PostgreSQL スキーマ
