# Supabase 構成のシンプル化

Table Editor で迷いやすい **schema の重複**を段階的に減らす運用ガイドです。破壊的 DROP（`veliora` テーブル削除など）は行いません。

## どこを見るか（正）

| 用途 | schema / オブジェクト |
|------|------------------------|
| NEAR 業務データ | `near.*` |
| SERA 業務データ | `sera.*` |
| LIRA 監査 | `lira.*` |
| 組織横断 AI（正典） | `veriora.*` |
| LINE 横断履歴（閲覧） | `veliora.line_messages`（**VIEW**、063 以降は canonical + legacy 統合） |
| RITS ログ（実テーブル） | `public.agent_logs` 等（RLS 062 済み・サーバーは service_role） |

`public` は **RITS 実テーブル + 廃止した NEAR 互換 VIEW** のみ。NEAR の `inbound_messages` 等の `public.*` VIEW は **063 で削除**（実体は `near.*`）。

## `veliora` と `veriora` の関係

- **別 schema**（綴り違いの併存）。データの二重管理を減らすため、**書き込みの正は `veriora.messages`**。
- **`veliora.line_message_events`** はレガシー実テーブル（063 以降、書き込みは env でオフ可能）。

## LINE ログの書き込み（NEAR / SERA）

| 環境変数 | 既定 | 意味 |
|----------|------|------|
| `VERIORA_CANONICAL_LINE_LOG` | `true` | `veriora.messages` へ書き込み（`legacy_row_id` があるとき） |
| `VERIORA_LEGACY_VELIORA_LINE_LOG` | `true` | `veliora.line_message_events` へ書き込み |
| `VERIORA_CORE_DUAL_WRITE` | `false` | **非推奨**。`true` のとき canonical を強制 ON（後方互換） |

**シンプル運用（推奨・検証後）**

1. 本番で `061` backfill を一度実行（任意・冪等）。
2. `VERIORA_CANONICAL_LINE_LOG=true`（既定）のまま動作確認。
3. 問題なければ `VERIORA_LEGACY_VELIORA_LINE_LOG=false` でレガシー veliora への新規 INSERT を停止。

管理 API `GET /admin/veliora/line-messages` は **`veliora.line_messages` VIEW** を参照するため、legacy 停止後も canonical 行は表示されます。

## migration ロードマップ

| Phase | 内容 | 状態 |
|-------|------|------|
| 1 | `veriora` schema + repositories + agent registry | 完了（053–061） |
| 2 | RLS / `security_invoker`（062） | 完了 |
| 3 | 統一読取 VIEW + `public` NEAR VIEW 削除（063） | 本 migration |
| 4 | 本番で legacy 書き込み OFF | 運用（env） |
| 5 | RITS を `veriora.message_feed` 中心に接続 | 別 PR 可 |

## バックフィル

`061_veriora_backfill_messages_optional.sql`（各リポ連番同期）を Supabase SQL Editor または `ensureSchema` で適用。冪等です。
