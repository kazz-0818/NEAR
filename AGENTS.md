# AGENTS.md — Veliora 組織OS（AI エージェント向け）

このリポジトリは **Veliora**（AI エージェントが役割分担する組織 OS）の一部です。人間・AI いずれが変更する場合も、**既存の本番挙動を壊さない**ことを最優先してください。

## 正典とレガシー表記

- **組織・ブランド名（正典）**: **Veliora**
- **Postgres（migration 073 以降）**: 正典スキーマ `veliora`、旧 LINE イベントは `veliora_line_legacy`（`VELIORA_LEGACY_LINE_LOG`）
- **env**: 推奨 `VELIORA_*`。`VERIORA_*` は互換 alias（`src/config/envAlias.ts`）
- **コード**: `velioraHandoff.ts` が正。`verioraHandoff.ts` は re-export シム
- **旧誤表記**: **Veriora** → **Veliora**。migration ファイル名の `053_veriora_*` は適用履歴のためリネームしない

## このリポジトリの役割

各サービスは Veliora の「部署」に相当します。詳細は [`docs/veriora-architecture.md`](docs/veriora-architecture.md) を参照してください。

## 必読ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| [`docs/veriora-architecture.md`](docs/veriora-architecture.md) | 全体像・Phase ロードマップ |
| [`docs/env-conventions.md`](docs/env-conventions.md) | 環境変数命名規約 |
| [`docs/db-conventions.md`](docs/db-conventions.md) | DB / テーブル命名規約 |
| [`docs/new-agent-checklist.md`](docs/new-agent-checklist.md) | 新規 AI エージェント追加手順 |
| [`docs/supabase-schema.md`](docs/supabase-schema.md) | `veliora` schema・既存テーブル対応表 |
| [`docs/migration-plan.md`](docs/migration-plan.md) | migration 053–063 適用手順 |
| [`docs/supabase-simplification.md`](docs/supabase-simplification.md) | Table Editor 整理・LINE ログ env |
| [`docs/near-user-memory.md`](docs/near-user-memory.md) | ユーザー長期記憶（学習） |
| [`docs/agent-foldering.md`](docs/agent-foldering.md) | `src/agents/{agentKey}/` 構成 |

## Agent registry（コード）

- TypeScript サービス: `src/agents/`（`types.ts`, `registry.ts`, `index.ts`）+ `src/agents/{near,sera,irie,rits,lram}/`
- LIRA（Python）: `app/agents/` + `app/agents/{agentKey}/`
- Canonical DB: `src/services/supabase/`（LINE ログ・[`supabase-simplification.md`](docs/supabase-simplification.md)）
- ユーザー長期記憶: `src/services/user_memory_*.ts`（[`near-user-memory.md`](docs/near-user-memory.md)、既定 ON）

**現状**: **NEAR** は handoff（`velioraHandoff.ts`）等で `getVelioraAgentByKey` を実行経路で使用。他 TS リポは `src/agents/{key}/config.ts` で参照。IRIE は Python registry。全面接続は Phase 5 以降で段階的に（[`docs/veriora-architecture.md`](docs/veriora-architecture.md)）。

## 禁止事項（エージェント・人間共通）

- **秘密のコミット**（API キー、`.env`、サービスロールキー、長期トークン）
- **本番 DB の破壊的操作**（テーブル DROP、無確認の大量 DELETE、未検証 migration の本番適用）
- **既存 env キーの削除・リネームのみ**（互換 alias を用意しない置換）
- **LINE Webhook の契約変更**（署名検証を迂回・無効化する変更）
- **Render / Supabase の本番設定を、ローカル検証なしで一括変更**

## 承認が必要な作業（例）

- RLS ポリシーの変更、または anon / service_role の前提変更
- 会話ログ・監査ログに **生の PII** を残す設計変更
- 組織横断の `DATABASE_URL` や Supabase プロジェクトの切り替え
- 新エージェントの「対外向け自動投稿」系の自動化 ON

## 変更の粒度

- **小さくレビュー可能な差分**に分割する。
- ドキュメントとコードの同時大変更は避け、**ドキュメント → 型/registry → 接続**の順を推奨する。

## 質問・不整合を見つけたら

- `docs/veriora-architecture.md` の Phase 節を更新するか、NEAR の `docs/` に運用メモを追加して履歴を残す。
