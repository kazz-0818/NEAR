# Veriora 組織OS — アーキテクチャ概要

## Veriora とは

**Veriora** は、複数の AI エージェントが「部署」として役割分担し、人間のオペレーションとシステム境界を明確に保ちながら拡張するための **組織 OS** です。単一の巨大プロンプトではなく、**registry（役割定義）・環境変数・DB・ログ**を揃えて追加可能にします。

### レガシー表記について（Veliora）

既存のコードベース・Postgres には **Veliora** という識別子（例: `veliora` schema、`docs/VELIORA_OS.md`）が残っています。**本ドキュメントの canonical 名は Veriora** としますが、**DB schema 名や過去ドキュメントをこのタイミングで一括リネームしない**方針です。将来 Phase で「schema 別名 VIEW」「読み替えマッピング」などから段階的に寄せます。

## 組織としての位置付け

- **人間**: 方針決定・承認・例外処理・ブランド責任
- **Veriora エージェント**: 定型・調査・下書き・ログ化・取次ぎ
- **基盤**: env / DB / 監査 / ルーティング（Phase 3 以降で強化）

## 監査と正典の分離

- **監査（整合性・会話品質・改善指示）**: **RITS（AI人事部）** が実施。台帳は Supabase（`agent_audits` / `daily_reports`）。横断レポートは RITS リポジトリ `docs/veriora-consistency-audit.md`。
- **正典ドキュメント・core migration の置き場**: 実務上は **NEAR** の `docs/` および `053_veriora_core_schema.sql` を参照基準とし、他リポへコピー同期する。これは「NEAR が監査主体」という意味ではない。
- **NEAR（秘書部）**: 総合窓口に加え **LLM・handoff の裏方**（オーケストレーション）。監査レポートの出し元ではない。

## 現在の部署一覧（AI エージェント）

| id（registry） | code | 部署 | 主担当 |
|----------------|------|------|--------|
| `near` | NEAR | 秘書部 | 総合窓口・秘書・タスク整理・指示受付（**LLM / handoff の裏方**） |
| `sera` | SERA | マーケ部 | SNS・広告・集客・マーケ支援 |
| `lira` | LIRA | 経理部 | 売上・経費・請求・入金・利益管理 |
| `rits` | RITS | AI人事部 | **組織監査**・会話品質・役割遵守・改善指示 |
| `lram` | LRAM | 編集部 | BRAVO 編集・記事・WordPress 下書き（サービスリポジトリは今後追加） |

## 共通設計思想

1. **破壊的変更をしない**: 既存テーブル・env キー・Webhook 契約を尊重する。
2. **新規は規約に従う**: 追加分から `VERIORA_*` / `{AGENT}_*` を適用（詳細は [`env-conventions.md`](env-conventions.md)）。
3. **二重記録は段階的に**: 既存の業務テーブルと、横断ログ（Veliora `line_message_events` 等）の関係は [`db-conventions.md`](db-conventions.md) に従う。
4. **registry は単一の意味論**: `src/agents/registry.ts`（TS）および LIRA の `app/agents/registry.py` が **人間可読の正**（実行時必須ではない Phase）。

## 関連ドキュメント

- 組織横断整合性監査: RITS リポジトリ `docs/veriora-consistency-audit.md`（監査主体は RITS）
- LIRA [`line-group-policy.md`](../../LIRA/docs/line-group-policy.md) — グループ LINE 応答方針（組織参照用）
- [`env-conventions.md`](env-conventions.md) — 環境変数命名
- [`db-conventions.md`](db-conventions.md) — DB / テーブル命名・RITS / LRAM 接続方針
- [`new-agent-checklist.md`](new-agent-checklist.md) — 新規エージェント追加手順

## Agent registry の使い方（現状と今後）

- **現状（Phase 2→5）**: 各リポに registry 型定義を同梱。**NEAR** は `verioraHandoff` 等で `getVerioraAgentByKey` を実行経路で使用。**SERA / RITS / LRAM** は `src/agents/{key}/config.ts` で参照。LIRA は `app/agents/registry.py`。全面接続は Phase 5 以降で段階的に。
- **Phase 3**: `getEnv()` に **互換 alias**（legacy → canonical）を追加し、`.env.example` と Zod schema を同期。**実装済み**（各リポ `envAlias.ts` / LIRA `config_env_alias.py`）。
- **Phase 4 以降**: ルーティング・ログ・RITS 取り込みが registry の `code` / `id` と一致するよう段階接続。

参照 API（例）:

- TypeScript: `getVerioraAgentById("near")`, `getVerioraAgentByKey("near")`, `getVerioraAgentByCode("NEAR")`
- Postgres 正典: `veriora.*`（migration 053–063、[`supabase-schema.md`](supabase-schema.md)）
- Repository: `src/services/supabase/`（LINE ログは canonical 既定 ON、legacy veliora は env で停止可 — [`supabase-simplification.md`](supabase-simplification.md)）
- Python: `get_veriora_agent_by_id("near")`

## 禁止事項・承認フロー（要約）

詳細はルートの [`AGENTS.md`](../AGENTS.md) を参照。**本番 DB migration の未検証実行**、**秘密のコミット**、**既存 env の削除のみによるリネーム**は禁止です。

## Phase ロードマップ（参考）

| Phase | 内容 |
|-------|------|
| 0 | 現状調査 |
| 1 | ドキュメント整備（本リリース相当） |
| 2 | agent registry 追加 | **同梱済み**（一部リポで config / handoff 接続済み） |
| 3 | env 互換（alias・`.env.example` 同期） | **コード実装済み** |
| 4 | ログ形式・横断会話ログの統一 | **実装済み**（5部署 LINE + LIRA `/ask` → RITS） |
| 5 | ルーティング / ハンドオフ整理 | **実装済み**（NEAR handoff・registry） |
| 6 | RITS 監査の自動化・日次レポート | **実装済み**（顧客マスター監査節含む） |
| 7 | LRAM（WordPress・編集）本実装 | **実装済み**（下書き・嗜好ネタ選定。本番公開は Phase 5+） |
| 8 | 管理画面・LINE 表示の統一 | 各リポ admin **実装済み** |
| 9–11 | ベガパンク（共通顧客マスター） | Phase 1–4 **実装済み**（[`vegapunk-plan.md`](vegapunk-plan.md)） |

Phase 3 以降の詳細タスクは、実装時に `docs/veriora-architecture.md` に追記するか、NEAR の `docs/PHASE2_OPERATIONS.md` 等とリンクして管理してください。
