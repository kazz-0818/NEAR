# NEAR タスク管理（内部 DB）

## タスクとメモの違い

| | タスク (`near_tasks`) | メモ (`near_memos`) |
|--|----------------------|---------------------|
| 用途 | やること（完了・一覧・リマインド） | 参照用の自由文 |
| 典型発話 | 「〇〇をタスクに」「タスク完了 1」 | 「メモ」「覚えておいて: …」 |

「覚えて」だけの発話は、タスク追加キーワードが無い場合は **メモ** に寄せます。期限・完了・リマインドが含まれる場合は **タスク** です。

## チャット操作

### 一括追加

- 例: `見積送付、請求確認、在庫チェックをタスクに`
- 改行・読点・箇条書きで分割（`NEAR_TASK_BULK_EXTRACT_ENABLED` で LLM 補助）

### タスク + リマインド同時

- 例: `提案書作成をタスクに入れて明日17時にリマインド`
- `near_reminders.task_id` でタスクと紐付け

### カテゴリ

- 作成: `#仕事 カテゴリ作って`
- 一覧: `カテゴリ一覧` / `マーケのカテゴリ一覧`
- 付与: `提案書作成を営業に入れて` / `Aを仕事カテゴリのタスクに`
- フィルタ: `仕事のタスク一覧`

## DB（additive migrations）

- `071_near_reminders_task_id.sql` — `near_reminders.task_id`
- `072_near_task_categories.sql` — `near_task_categories`, `near_tasks.category_id`

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `NEAR_TASK_BULK_EXTRACT_ENABLED` | ON | 一括追加の LLM 抽出 |

## 関連コード

- `src/services/task_line.ts` — 一覧・完了・追加
- `src/services/task_compound_line.ts` — タスク+リマインド
- `src/services/task_bulk_extractor.ts` — 一括分割
- `src/services/task_category_line.ts` — カテゴリ CRUD
- `src/orchestrator/thinRouter.ts` — ルーティング
