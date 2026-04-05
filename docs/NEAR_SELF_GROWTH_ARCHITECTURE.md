# 自己成長型 NEAR — アーキテクチャ設計

**自己成長**とは、モデル重みの学習ではなく、  
「未対応を検知 → 不足分析 → 成長提案 → 管理者承認 → ヒアリング → 実装指示 →（手動/自動）実装 → 能力更新」  
のループで **capabilities を増やす**仕組みを指す。

本書は、**既存コードベース**（`GROWTH.md` 記載のモジュール群）との対応を明示し、足りない概念を **薄い追加** で吸収する方針とする。

---

## 1. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│ LINE ユーザー                                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ メインオーケストレータ（orchestrator.ts）                        │
│ ・秘書レイヤー → intent → モジュール                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 未対応（routable でない / モジュール unsupported）
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 【A】自己能力評価（self_capability_evaluator）                   │
│ ・今すぐ処理できるか / 確認で足りるか / 成長が必要か              │
│ ・現状: growth_suggestion_gate + intent 結果の合成で代替可能    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 成長パイプラインへ（ゲート通過時）
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ unsupported_request_logger → unsupported_requests (logged)       │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 【B】ギャップ分析（gap_analyzer）                                │
│ ・なぜできないか / 不足は何か / 成長種別                         │
│ ・現状: feature_suggester 内 LLM + improvement_kind 等           │
│ ・拡張: gap_type / request_mode_guess を DB に永続（010 マイグレーション）│
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 【C】成長計画（growth_planner）                                  │
│ ・要約・API・モジュール・難易度・リスク・初期 cursor_prompt      │
│ ・現状: feature_suggester.ts + prompts/feature_suggestion…       │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ implementation_suggestions INSERT + growth_orchestrator        │
│ onSuggestionCreated → 管理者 LINE 通知（admin_notification…）   │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 【D】管理者承認オーケストレーション                              │
│ ・第一段階 / 第二段階 / implementation_state 遷移               │
│ ・現状: approval_service.ts + growth_admin_line.ts              │
│ ・推奨: 新規 UPDATE は growth_orchestrator / approval_service 経由に集約│
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 【E】ヒアリング（growth_hearing_service）                        │
│ ・質問キュー・回答保存                                           │
│ ・現状: hearing_service.ts + growth_hearing_items テーブル       │
│ （ユーザーの growth_hearing_answers は items の key/value で実質同等）│
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 【F】Cursor 指示文（cursor_prompt_builder）                       │
│ ・第二承認後にフルプロンプト生成・DB 保存                        │
│ ・現状: cursor_prompt_builder.ts                                │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 【G】【H】coding_runner / deploy_runner                           │
│ ・手動モード既定 / 自動はアダプタ差し替え                        │
│ ・現状: coding_runner.ts, deploy_runner.ts                      │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 【I】capability_registry_sync                                    │
│ ・成長完了時に registry 更新                                     │
│ ・現状: capability_sync_service.ts                              │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 【J】成長メモリ / DB                                             │
│ ・unsupported_requests, implementation_suggestions,             │
│   capability_registry, growth_hearing_items, growth_execution_log│
└─────────────────────────────────────────────────────────────────┘
```

**要点:** 名前付きコンポーネントの多くは **既に実装済み**。自己成長型に見せるには、  
(1) **用語と責務のドキュメント化**、  
(2) **評価・ギャップのメタデータを DB に残す**、  
(3) **状態更新の単一路径**（バラ UPDATE 禁止のルール）  
を徹底するとよい。

---

## 2. 追加・強化する DB スキーマ

### 既存（変更なしで利用）

| テーブル | 役割 |
|----------|------|
| `unsupported_requests` | 未対応ログ・フィンガープリント・status 遷移 |
| `implementation_suggestions` | 提案本文・承認・実装状態・cursor_prompt |
| `growth_hearing_items` | ヒアリング Q&A（`question_key` / `answer_text`） |
| `growth_admin_sessions` | 管理者の active_suggestion |
| `capability_registry` | ユーザー向け能力一覧（help に連動） |
| `admin_notify_log` | 管理者通知クールダウン |

### 010 マイグレーションで追加（`010_self_growth_audit.sql`）

| 変更 | 目的 |
|------|------|
| `unsupported_requests.request_mode_guess` | 秘書レイヤー推定のスナップショット（分析用） |
| `unsupported_requests.gap_type` | ギャップ分類（下記 enum 文字列） |
| `unsupported_requests.self_eval_json` | 評価レイヤーの構造化メモ（任意） |
| `capability_registry.request_mode` | intent と独立したモード表示用（任意） |
| `capability_registry.version` | 能力バージョン表記 |
| `growth_execution_log` | Phase 1 では最小限、Phase 3 で本格活用 |

### gap_type（推奨値）

`prompt_tune` | `routing_improvement` | `new_module` | `external_integration` | `auth_required` | `knowledge_missing` | `out_of_scope` | `unknown`  

既存の `improvement_kind` と整合させる場合は、LLM 出力を `gap_type` にコピーするか、マッピングテーブルを将来追加。

---

## 3. 追加・修正するファイル一覧

| 種別 | パス | 内容 |
|------|------|------|
| 新規 | `docs/NEAR_SELF_GROWTH_ARCHITECTURE.md` | 本書 |
| 新規 | `src/db/migrations/010_self_growth_audit.sql` | 列・ログテーブル追加 |
| 修正 | `src/db/ensureSchema.ts` | `010` を読み込みリストに追加 |
| 任意（Phase 1） | `src/services/self_capability_evaluator.ts` | ゲート＋intent の薄いラッパ（後述） |
| 任意（Phase 1） | `src/services/gap_analyzer.ts` | `feature_suggester` 前後で gap を書き込むヘルパ |
| 任意（Phase 1） | `src/services/growth_planner.ts` | `generateAndSaveSuggestion` のエイリアス／分割用 |
| 任意（Phase 2） | `src/services/growth_state_machine.ts` | UPDATE 集約（approval + orchestrator から段階的に移管） |
| 既存参照 | `feature_suggester.ts` | 成長提案の中核（growth_planner 実体） |
| 既存参照 | `growth_orchestrator.ts`, `approval_service.ts`, `hearing_service.ts` | 承認・状態・ヒアリング |
| 既存参照 | `cursor_prompt_builder.ts`, `coding_runner.ts`, `deploy_runner.ts` | 実装・デプロイ抽象 |
| 既存参照 | `capability_sync_service.ts` | 能力更新 |

**推奨:** いきなりファイルを増やさず、**まず本書と DB 列**で観測可能にし、ループが回ったら薄い `self_capability_evaluator.ts` を足す。

---

## 4. 各サービスの責務一覧（名前 ↔ 実装）

| 設計名 | 既存実装 | 責務 |
|--------|----------|------|
| self_capability_evaluator | `growth_suggestion_gate` + orchestrator の分岐 | 未対応に入る前の「本当に成長対象か」／短文・out_of_scope 等 |
| gap_analyzer | `feature_suggester` の LLM 出力 + **新規 gap 列** | 不足理由の型付け |
| growth_planner | `feature_suggester` | 提案 JSON → `implementation_suggestions` |
| admin_approval_orchestrator | `growth_orchestrator` + `approval_service` + `growth_admin_line` | 承認・状態遷移・LINE |
| growth_hearing_service | `hearing_service` + `growth_hearing_items` | 順番に質問・回答保存 |
| cursor_prompt_builder | `cursor_prompt_builder.ts` | フル実装指示 |
| coding_runner | `coding_runner.ts` | 手動 / Issue / エージェント POST |
| deploy_runner | `deploy_runner.ts` | 手動 / スタブ自動 |
| capability_registry_sync | `capability_sync_service.ts` | 成長完了で registry 更新 |
| growth memory | 上記テーブル群 + `growth_execution_log` | 監査・デバッグ |

---

## 5. 状態遷移設計

### `implementation_suggestions.approval_status`

`pending` → `approved` | `rejected`（第一段階）

### `implementation_suggestions.implementation_state`

既存（`growth_constants.ts`）:

`not_started` → `awaiting_user_consent`（ユーザー同意ルートあり）→ `hearing_required` → `awaiting_final_approval` → `coding` → `testing` → `deploy_candidate_ready` → `deploying` → `implemented` | `failed`

**ルール:** `implementation_suggestions` / `unsupported_requests.status` の更新は **`approval_service` / `growth_orchestrator` / `hearing_service`** 経由に限定し、直接 `UPDATE` しない（新規コード含む）。

### `unsupported_requests.status`

既存: `logged` → `suggestion_created` → … → `implemented` | `rejected` | `failed`  
（`user_consent_requested` / `user_hearing_in_progress` はユーザー成長フロー用）

ユーザー提示リストとの差分は **名称の別名** が一部あるだけなので、**新規 status は増やさず** 既存マップに寄せる。

---

## 6. 管理者承認フロー

1. `onSuggestionCreated` → 管理者へ LINE（第一段階「進めてよいか」）。
2. 「はい」→ `approval_service` で `hearing_required` 等へ。
3. `hearing_service` で項目を消化。
4. 第二段階「実装に進めてよいか」→ はいで `cursor_prompt_builder` → `coding`。
5. 手動モード: 管理者が Cursor に `cursor_prompt` を投入。
6. 「成長完了」等で `capability_sync_service` + `implemented`。

詳細は `growth_admin_line.ts` / `GROWTH.md` の state 図。

---

## 7. ヒアリングフロー

- `hearing_service` が `growth_hearing_items` に質問を並べ、LINE で 1 問ずつ回答を保存。
- 完了後 `awaiting_final_approval` へ。

（ユーザー案の `growth_hearing_answers` は **`growth_hearing_items` で代替**可能。将来キー値のみ抽出したい場合は VIEW または正規化テーブル。）

---

## 8. Cursor 向け指示文生成設計

- **入力:** `implementation_suggestions` + `unsupported_requests` + ヒアリング結果（`required_information` JSONB）。
- **出力:** `cursor_prompt`（フル）。短縮版が必要なら `summary` または新列 `cursor_prompt_excerpt`（将来）。
- **含めるべき要素:** 目的、推奨 intent / request_mode、触るファイル方針、環境変数、テスト・受け入れ条件、デプロイ注意 — 既存 `cursor_prompt_builder` のテンプレを拡張。

---

## 9. 手動モード MVP 方針

**Phase 1（現状に近い）**

- 自己評価はゲート＋ログ強化（`gap_type` / `request_mode_guess`）。
- 成長提案〜承認〜ヒアリング〜`cursor_prompt` 生成は **既存のまま**。
- `coding_runner` / `deploy_runner` は **手動・スタブ**のまま。

**ユーザー向けコピー（体験）**

- 未対応返答 + 「改善候補として記録」は orchestrator の unsupported 文案と整合。
- 成長側は `growth_user_line`（同意）と管理者 LINE を継続利用。

---

## 10. 将来の自動実装モード（Phase 3）

- `GROWTH_AUTO_CODING_ENABLED` + GitHub Issue または `GROWTH_CODING_AGENT_URL`。
- `deploy_runner` のアダプタを CI/CD に接続（承認・`deploy_safety_confirmed` 必須のまま）。
- `growth_execution_log` に `phase` / `status` を追記し、監査可能にする。

---

## 非目標（再掲）

- モデル重みの継続学習  
- 無承認の本番自動デプロイ  
- 危険な権限変更の自動化  
- 全未対応の即時自動実装  

---

## NEAR の本質定義（自己成長版）

NEAR は **「できないことを記録するだけのボット」ではない**。  
物理行動以外では秘書として巻き取り、**できないと判断したときは不足を分析し、成長提案を行い、管理者の承認のもとで能力を増やす**。

---

## 実装フェーズ対応表

| Phase | 内容 | 既存との関係 |
|-------|------|----------------|
| 1 | unsupported 強化、gap メタ、提案・承認・ヒアリング・cursor・手動 | ほぼ既存 + DB 列 + 観測 |
| 2 | runner 抽象の明確化、registry の version/request_mode、状態マシン集約 | リファクタ中心 |
| 3 | 自動 coding/testing/deploy、execution_log 強化 | 環境変数 + アダプタ |
