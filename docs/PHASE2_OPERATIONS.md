# Phase2 運用メモ（Web 検索ポリシー・副作用確認・監査）

## Web 検索ポリシー（`NEAR_WEB_SEARCH_POLICY_ENABLED`）

- **オフ（既定）**: `NEAR_AGENT_WEB_SEARCH` のみで付与可否を決める（従来どおり）。
- **オン**: 次の優先順で **1 つだけ**採用し、`web_search_preview` を付けるか決める。

1. **明示キーワード**（天気・為替・ニュース・株・「検索して」等）→ **付与**（`explicit_keyword`）
2. ユーザー本文が **`NEAR_WEB_SEARCH_MIN_CHARS` 未満** → 不付与（`text_too_short`）
3. 発話が **スプレッドシート／表・カレンダー文脈**に強い → 不付与（`sheet_or_calendar_context`）
4. 上記以外 → 不付与（`default_no_search`）

マスター無効は常に不付与（`env_master_off`）。ポリシー **オフ**で検索が有効な場合の理由コードは `policy_disabled_legacy_attach`。

## `agent_search_runs` ログ

- テーブルは `ensureSchema` で作成（マイグレーション `016` + `017`）。
- 挿入条件: `NEAR_AGENT_SEARCH_RUNS_LOG=true` **または**（未設定かつ）`NEAR_WEB_SEARCH_POLICY_ENABLED=true`。
- 明示オフ: `NEAR_AGENT_SEARCH_RUNS_LOG=0`。

管理 API: `GET /admin/agent-search-runs`（Bearer `ADMIN_API_KEY`）。

## 副作用ツール確認（`pending_tool_confirmations`）

- **オフ（既定）**: ツールは従来どおり即実行。
- **オン**（`NEAR_TOOL_CONFIRM_ENABLED=1`）かつ `NEAR_TOOL_CONFIRM_TOOLS` に含まれるツール:
  - 初回は **DB に args を保存**し、ユーザーへ確認文案を返す。
  - ユーザーが **短い肯定**（`user_sheet_pending_confirm_repo` と同系統）→ **保存済み `args_json` のみ**で `taskManager` / `memoStore` / `reminderManager` を実行（再パースしない）。
  - **短い否定** → 保留を `cancelled`。
- **ブロッキング**（`NEAR_TOOL_CONFIRM_BLOCKING`、既定オン）: 保留中に肯定/否定以外の発話は、先に確認を促す返信のみ（通常ルートに進まない）。
- 非ブロッキング（`NEAR_TOOL_CONFIRM_BLOCKING=0`）: 肯定/否定だけ消費し、それ以外は通常処理へ。

Thin Router の直後に保留消費が走る（`tryHandlePendingToolConfirmation`）。

管理 API: `GET /admin/pending-tool-confirmations`（`pending` かつ未失効のみ）。

## 関連環境変数（抜粋）

| 変数 | 既定 | 説明 |
|------|------|------|
| `NEAR_WEB_SEARCH_POLICY_ENABLED` | オフ | 上記ポリシー適用 |
| `NEAR_WEB_SEARCH_MIN_CHARS` | 24 | ポリシー ON 時の最短文字数 |
| `NEAR_AGENT_SEARCH_RUNS_LOG` | 未設定→ポリシーに連動 | `agent_search_runs` 挿入 |
| `NEAR_TOOL_CONFIRM_ENABLED` | オフ | 副作用確認フロー |
| `NEAR_TOOL_CONFIRM_TOOLS` | 3 ツール列挙 | カンマ区切り API 名 |
| `NEAR_TOOL_CONFIRM_TTL_MINUTES` | 30 | 保留の有効期限（1〜120） |
| `NEAR_TOOL_CONFIRM_BLOCKING` | オン | 保留中の他処理ブロック |

詳細は `.env.example` を参照。
