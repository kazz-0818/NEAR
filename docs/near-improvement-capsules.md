# NEAR Improvement Capsule（改善カプセル）

## 改善カプセルとは

LINE 会話ログから、**NEAR の返答品質・文脈理解・ルーティング・Growth 判定**に改善余地がありそうな点を検知し、開発側へ「改善カプセル」として提案する仕組みです。  
ユーザーが明示的に「機能を足して」と依頼する **Growth Request** とは入口を分けます。

## Growth との違い

| | Growth Request | Improvement Capsule |
|---|----------------|---------------------|
| 起点 | ユーザーが「実装して」「機能追加」など**明示的な開発依頼** | NEAR がログを見て**品質・ルーティングの改善余地**を検知 |
| 会話時の LLM | 成長フロー用の意図・難易度など（既存） | **毎ターンは使わない**（軽量ルールのみ） |
| Issue 化 | suggestion 経由の既存フロー | **カプセル専用コマンド**だが、Issue には `near-growth` / `cursor-agent` / `improvement-capsule` ラベルで既存エージェント運用に乗せる |

## 日次まとめ分析型であること

1. 会話中は **軽量ルール**で「怪しい」ターンだけ `improvement_candidates` に記録する。  
2. **1 日 1 回**（既定: **23:00 JST**、`NEAR_IMPROVEMENT_CAPSULE_CRON_EXPR` / `NEAR_IMPROVEMENT_CAPSULE_CRON_TZ` で変更）と、**管理者の手動**で `pending` をまとめて LLM に渡す。  
3. LLM が **改善カプセル**を JSON で返し、`improvement_capsules` に保存する。  
4. **confidence が閾値以上**のカプセルだけ管理者 LINE にまとめ通知する。

## なぜ毎回 LLM 分析しないのか / API 使用量

- 全会話を LLM に送るとコストと遅延が線形に増える。  
- まずルールでノイズを落とし、**候補だけ**を溜める。  
- **pending が 0 件のときは LLM を呼ばない**。  
- 分析済み候補は `analyzed` にし、**同じ pending を二重に分析しない**。  
- 1 回の LLM 呼び出しは最大 **20 件**の候補まで（それ以上は複数バッチ）。

## 候補ログ（improvement_candidates）

保存例（トリガー理由の一部）:

- ユーザーが返答を否定・修正する語句  
- 「それ」「1番」など直前文脈参照っぽい短文  
- 短時間に似た内容を何度も言い直し  
- ルーティング上のヒューリスティック（例: 構造化 intent なのに LLM フォールバック、モジュール unsupported 後に Growth など）

## カプセル生成（improvement_capsules）

- バッチごとに `analysis_batch_id`（UUID）を付与。  
- LLM の JSON から `problem_type`, `problem_summary`, `context_summary`, `improvement_proposal`, `suggested_requirements`, `priority`, `confidence`, `source_candidate_ids` を保存。  
- **confidence が `NEAR_IMPROVEMENT_CAPSULE_NOTIFY_MIN_CONFIDENCE`（既定 0.7）未満**は通知しない（DB には残る）。

## 管理者通知

- 閾値以上のカプセルが **1 件以上**あるときのみ、管理者向けチャネル（`GROWTH_APPROVAL_GROUP_ID` または `ADMIN_LINE_USER_ID`）へ LINE プッシュ。  
- 日次ジョブで候補が無い場合は **通知しない**。  
- 手動分析で pending が 0 のときは LINE 返信で「改善候補はありませんでした」。

## 管理者コマンド（LINE）

- 一覧: 「改善カプセル一覧」「最近の改善カプセル」「未対応カプセル一覧」  
- 詳細: 「カプセル 123 詳細」「改善カプセル 123 見せて」  
- Issue 化: 「カプセル 123 Issue化して」など（`GITHUB_TOKEN` / `GROWTH_GITHUB_REPO` が必要）  
- 却下: 「カプセル 123 却下」「これは不要」  
- 手動分析: 「改善カプセル分析して」「今日の改善カプセル作って」「未分析カプセルを分析して」  

※ 管理者 LINE は **Growth コマンドより先に**改善カプセルを解釈し、`カプセル` 系を Growth の suggestion ID と取り違えにくくしています。

## GitHub Issue 化

- 本文テンプレはコード内 `buildImprovementCapsuleIssueBody`（`# NEAR Improvement Capsule` 見出し、`capsule_id`、禁止事項・テスト・完了条件、ローカル同期ブロック）。  
- ラベル: **`near-growth`**, **`cursor-agent`**, **`improvement-capsule`**（および `GROWTH_GITHUB_ISSUE_LABELS` で追加されたラベル）。

## Cursor Agent 実装

Issue は既存の Growth / Cursor Agent 用ワークフロー向けフォーマットで作成されます。実装時は既存のタスク・Sheets・Growth・PR 反映フローを壊さない最小差分を守ってください。

## ローカル同期ルール

Issue 本文に `growthLocalSyncMarkdownSection` 相当のブロックを含めます。マージ後は自動ではローカルに反映されないため、作業前に `git pull` などを実行してください。

## 運用 API

- **Cron / Render 等**: `POST /internal/improvement-capsules/analyze`（`CRON_SECRET` 設定時は `Authorization: Bearer …`）  
- **管理 API**: `POST /admin/improvement-capsules/analyze`（Bearer `ADMIN_API_KEY`）

## 環境変数（主要）

| 変数 | 説明 |
|------|------|
| `NEAR_IMPROVEMENT_CAPSULES_ENABLED` | `false`/`0` で無効（未設定はオン） |
| `NEAR_IMPROVEMENT_CAPSULE_CRON_EXPR` | node-cron 式（既定 `0 23 * * *`） |
| `NEAR_IMPROVEMENT_CAPSULE_CRON_TZ` | タイムゾーン（既定 `Asia/Tokyo`） |
| `NEAR_IMPROVEMENT_CAPSULE_MODEL` | 分析用モデル（未設定は `OPENAI_INTENT_MODEL`） |
| `NEAR_IMPROVEMENT_CAPSULE_NOTIFY_MIN_CONFIDENCE` | 通知下限 confidence（既定 0.7） |
| `NEAR_IMPROVEMENT_CAPSULE_RAPID_WINDOW_MINUTES` | 言い直し検知の窓（既定 10） |
