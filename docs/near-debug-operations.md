# NEAR 運用デバッグ（ルーティングレポート・セッションメモリ・改善ワンクリック）

## 概要

LINE 上で「なぜそう判断した？」「今の返答おかしい」などと送ったときの挙動です。**API キーや `.env` の値は保存・表示しません。** ルーティング要約は短文に留めます。

## ルーティング判定レポート

**管理者以上**（`admin` / `developer` ロール）が、次のような文言を送ると、**一つ前の inbound に対応する** `routing_traces` の要約を返します。

例: 「なぜそう判断した？」「直前の判定見せて」「ルーティング確認」「なぜDriveに行った？」「なぜスプレッドシート読んだ？」

一般ユーザーが送った場合は「ルーティングの詳細は管理者向けです。」のみ返します。

保存テーブル: `routing_traces`（マイグレーション `044_routing_trace_session_memory.sql`）。各 LINE ターンの `inbound_messages.id` に 1 行紐付け、返信確定時に `route` / `intent` / `final_reply_summary` 等を更新します。

## 会話セッションメモリ（短期）

テーブル: `conversation_session_memory`。`expires_at` を過ぎた行は参照しません。

主な `memory_type`:

| memory_type | 用途の目安 |
|-------------|------------|
| `latest_task_created` | 直近に追加したタスク（「これ明日に通知」など） |
| `latest_task_list` | 直近に表示したタスク一覧の番号付き行 |
| `latest_reminder_list` | 直近に表示したリマインド一覧（「1番を削除」など） |
| `latest_reminder_created` / `latest_reminder_updated` | 直近のリマインド作成・時刻変更（「やっぱり14時に」解決） |

## ワンクリック改善候補

「今の返答おかしい」「カプセル化して」「文脈ミスとして保存して」などは、`improvement_candidates` に **手動トリガー**で保存します。**この時点では Issue を作りません。** あとから「改善カプセル分析して」で日次／手動バッチに回します。

重複: 同一 `inbound_message_id` かつ同一 `trigger_reason` の `pending` が既にある場合は二重登録しません。

## よく使う LINE コマンド（再掲）

- ルーティング確認（管理者）: 上記フレーズ  
- 改善候補に載せる: 「今の返答おかしい」「カプセル化して」  
- 分析実行（管理者）: 「改善カプセル分析して」（既存 Improvement Capsule 管理コマンド）

## 実機テスト手順（例）

1. 通常どおり会話し、意図と違う返答が出たら「なぜそう判断した？」（管理者アカウントで）を送り、`routing_traces` の要約が返ることを確認する。  
2. 「今の返答おかしい」を送り、「保存しました」系の短文と、管理 DB で `improvement_candidates` に行が付くことを確認する。  
3. タスク追加 →「これ明日の13時に通知して」→ リマインドが意図どおり立つか確認する。  
4. リマインド一覧表示 →「1番を削除して」→ 該当リマインドが消えるか確認する。

## 関連コード

- `src/services/routing_trace_service.ts` — trace 作成・更新・直前取得  
- `src/services/routing_debug_command.ts` — フレーズ検出・LINE 用整形  
- `src/services/conversation_session_memory.ts` — 短期メモリ upsert / 取得  
- `src/services/improvement_manual_capture.ts` — 手動改善候補保存  
- `src/orchestrator/thinRouter.ts` — 優先順位（デバッグ → ワンクリック → Turn Resolver → pending…）
