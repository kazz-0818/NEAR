# Phase2 ルーティング（Thin Router / Agent / Legacy）

## 処理順（`handleLineTextMessage`）

1. **Thin Router**（`src/orchestrator/thinRouter.ts`）  
   管理者成長・ユーザー成長・Google OAuth / アカウント・デプロイ時刻・WhatsNew。ここで終われば返信のみ。

2. **会話文脈読み込み**のあと、**副作用ツール保留の消費**（`tryHandlePendingToolConfirmation`）  
   `NEAR_TOOL_CONFIRM_ENABLED` 時のみ。肯定は DB に保存した args のみで実行。詳細は [`PHASE2_OPERATIONS.md`](./PHASE2_OPERATIONS.md)。

3. **秘書レイヤー**（従来どおり `orchestrator.ts` 内）

4. **意図分類** + **シート promotion**（`promoteSheetsPendingPick` 等）

5. **`shouldInvokeNearAgent`**（`src/orchestrator/routingDecision.ts`）  
   - `NEAR_AGENT_ENABLED` がオフなら常に false。  
   - `google_sheets_query` かつレガシーで処理可能なら **エージェントに入れない**（`sheets_query` 直叩きへ）。  
   - `NEAR_PHASE2_SIDE_EFFECTS_VIA_AGENT` かつ `task_create` / `memo_save` / `reminder_request` / `summarize` かつ routable なら **エージェント優先**。  
   - それ以外は従来の `shouldUseNearAgent`（影モード / Primary）。

6. **レガシー registry**（`getHandler`）— 上記でエージェントに入らなかった場合のみ。

## 返信整形（`composeNearReplyUnified`）

`src/agent/compose/nearComposer.ts` が **skip / light / full** を選び、`reply_composer.ts` の `composeNearReply` / `composeNearReplyLight` を呼ぶ。

- **エージェント経路**では `NEAR_AGENT_SKIP_COMPOSE=1` のときは従来どおり Unified を呼ばず生テキスト送信。
