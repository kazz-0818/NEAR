# Veriora — 環境変数（env）命名規約

## 目的

- エージェントやサービスが増えても **衝突なく** 環境変数を追加できるようにする。
- **Render / Supabase / LINE / OpenAI** など用途別に見通しを良くする。
- **既存キーは削除しない**。新規命名を足し、Phase 3 で **互換 alias**（読み取り時に旧名をフォールバック）をコードに入れる。

## 正典名とレガシー

- 組織名の正典: **Veriora**
- 既存の `VELIORA_*` や `veliora` schema 名は **このドキュメントだけでは変更しない**（別 Phase）。

## 基本ルール

1. **大文字 `SNAKE_CASE`**（慣例に合わせる）。
2. **共通（組織横断）**: `VERIORA_` 接頭辞を推奨（例: `VERIORA_LOG_LEVEL`, `VERIORA_PUBLIC_BASE_URL`）。
3. **エージェント固有**: `{AGENT_CODE}_` 接頭辞。**AGENT_CODE** は registry の `id` と一致する **ASCII 小文字**（`near`, `sera`, `lira`, `rits`, `lram`）。
4. **インフラが注入する変数**はそのまま利用可（例: `PORT`, `NODE_ENV`, `RENDER_EXTERNAL_URL`）。無理に `VERIORA_` を付けない。
5. **新規キーから本規約を適用**する。既存キーは **非推奨（deprecated）として文書化**しつつ残す。

## 互換 alias（Phase 3 で実装予定）

読み込み優先順の例:

1. `NEAR_LINE_CHANNEL_SECRET` があればそれを使用
2. なければ従来の `LINE_CHANNEL_SECRET`（同一デプロイ内で後方互換）

**原則**: 本番の `.env` / Render のダッシュボードを一斉リネームしないでもデプロイできること。

## 必須 / 任意

- **必須**: 各サービスの `getEnv()` / `Settings` が起動時に検証するキー（サービスごとに異なる）。真実の一覧は **各リポジトリの config** を参照:
  - NEAR: `src/config/env.ts`
  - SERA: `src/config/env.ts`
  - LIRA: `app/config.py`
  - RITS: `src/config/env.ts`
- **任意**: 機能フラグ、通知先、モデル名の上書き、開発用パス等。

## 本番のみ / 開発のみ

| 区分 | 例 | 備考 |
|------|-----|------|
| 本番推奨 | `NODE_ENV=production`, 本番 `DATABASE_URL` / Supabase URL | 秘密は Render のみ |
| 開発のみ | ローカル OAuth リダイレクト、デバッグフラグ | 本番ではオフ推奨 |

## Render に登録する env の考え方

- **Blueprint（`render.yaml`）に平文で書かないもの**: API キー、DB URL、署名用シークレット → `sync: false` またはダッシュボード手入力。
- **サービスごとに分離したい秘密**: `{agent}_` 接頭辞（SERA の `SERA_LINE_*` は好例）。
- **URL 系**: 末尾スラッシュなしを推奨（各 README に準拠）。

## 用途別の命名例（新規推奨）

以下は **例** である。既存キーと並存させる。

### Supabase（HTTP API: REST）

- `VERIORA_SUPABASE_URL`（組織共通にしたい場合）
- `RITS_SUPABASE_URL` + `RITS_SUPABASE_SERVICE_ROLE_KEY`（サービス専用）

※ RITS は現状 `SUPABASE_URL` 等を使用。**Phase 3 で alias**。

### Postgres（接続文字列）

- 多くのサービスで `DATABASE_URL` が既存。**共通プールを使う場合も当面は `DATABASE_URL` を維持**し、コメントで所属を明示。

### LINE

- `NEAR_LINE_CHANNEL_SECRET`, `NEAR_LINE_CHANNEL_ACCESS_TOKEN`
- `SERA_LINE_CHANNEL_SECRET`（既存パターン）
- `LIRA_LINE_CHANNEL_SECRET`, `RITS_LINE_CHANNEL_SECRET`, `LRAM_LINE_CHANNEL_SECRET`（将来）

### OpenAI

- `VERIORA_OPENAI_API_KEY`（組織で 1 キー共有する場合のみ検討）
- または `NEAR_OPENAI_API_KEY` 等に分割（課金・キー失効のblast radius 低減）

### WordPress（LRAM 想定）

- `LRAM_WP_BASE_URL`, `LRAM_WP_APPLICATION_USER`, `LRAM_WP_APPLICATION_PASSWORD`（名前は Phase 7 で確定）

### GitHub

- `VERIORA_GITHUB_TOKEN` または `NEAR_GITHUB_TOKEN`（用途が NEAR 成長ループ専用なら後者）

### Cron / 内部ジョブ

- `VERIORA_CRON_SECRET` または既存の `CRON_SECRET` を維持し alias

## 非推奨（deprecated）の扱い

- **削除しない**。`docs/env-conventions.md` または各サービスの README に「非推奨。代替は ○○」と書く。
- コード側では **読み取り時に警告ログ**（Phase 3）。

## `.env.example` と config の同期

- **新規 env を追加したら**: `.env.example`（および LIRA の `env/*.example`）と **config スキーマ**を同じ PR で更新する。
- **値は書かない**（プレースホルダとコメントのみ）。

## 参考（Veliora OS）

NEAR / SERA の Postgres 統一ログについては、従来ドキュメント `docs/VELIORA_OS.md`（NEAR リポジトリ）を参照。env 名そのものの正典は **本ドキュメント（Veriora）** に寄せていく。
