# AGENTS.md — Veriora 組織OS（AI エージェント向け）

このリポジトリは **Veriora**（AI エージェントが役割分担する組織 OS）の一部です。人間・AI いずれが変更する場合も、**既存の本番挙動を壊さない**ことを最優先してください。

## 正典とレガシー表記

- **組織・設計上の正典名**: **Veriora**
- **レガシー（コード・DB に残りうる表記）**: **Veliora**（例: Postgres の `veliora` schema、`VELIORA_OS.md` など）。**いきなり全置換しない**。表記統一は別 Phase で計画する。

## このリポジトリの役割

各サービスは Veriora の「部署」に相当します。詳細は [`docs/veriora-architecture.md`](docs/veriora-architecture.md) を参照してください。

## 必読ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| [`docs/veriora-architecture.md`](docs/veriora-architecture.md) | 全体像・Phase ロードマップ |
| [`docs/env-conventions.md`](docs/env-conventions.md) | 環境変数命名規約 |
| [`docs/db-conventions.md`](docs/db-conventions.md) | DB / テーブル命名規約 |
| [`docs/new-agent-checklist.md`](docs/new-agent-checklist.md) | 新規 AI エージェント追加手順 |

## Agent registry（コード）

- TypeScript サービス: `src/agents/`（`types.ts`, `registry.ts`, `index.ts`）
- LIRA（Python）: `app/agents/`

**現状**: 実行経路からは参照しない前提で追加されています（統一基盤の置き場）。Phase 3 以降で `getEnv` やルーティングから段階的に接続します。

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
