# LLM usage → RITS 連携（準備）

## 方針

- **いま**: 各 LLM 応答の `usage` を捨てない。`recordLlmUsage()` で構造化ログ（debug）のみ。
- **あとで**: RITS が `POST /admin/usage` を実装したら、env を入れるだけで自動送信。

## 環境変数（任意・全エージェント共通想定）

| 変数 | 意味 |
|------|------|
| `VERIORA_RITS_BASE_URL` | RITS のベース URL（例 `https://rits.onrender.com`） |
| `VERIORA_RITS_ADMIN_API_KEY` | `x-admin-api-key`（RITS の `ADMIN_API_KEY` と同値） |

## コード

- 共通: `src/lib/llmUsage.ts`
  - `usageFromChatCompletion()` — Chat Completions API
  - `usageFromResponse()` — Responses API（agent runner）
  - `recordLlmUsage()` — 記録 + 将来 RITS 送信

### 接続済み（NEAR）

| source | ファイル |
|--------|----------|
| `intent_classifier` | `src/services/intent_classifier.ts` |
| `near_agent` | `src/agent/runner.ts` |
| `reply_composer` / `reply_composer_light` | `src/services/reply_composer.ts` |

### 未接続（必要に応じて 1 行追加）

`completion` または `resp` の直後に:

```typescript
const u = usageFromChatCompletion(completion, { agentName: "NEAR", source: "モジュール名" });
if (u) recordLlmUsage(u);
```

- `src/modules/faq_answerer.ts`
- `src/modules/feature_suggester.ts`
- `src/modules/summarizer.ts`
- `src/modules/sheets_query_llm.ts`
- `src/services/hearing_service.ts`
- `src/services/improvement_capsule_analyzer.ts`
- `src/services/llm_fallback_answer.ts`
- その他 `chat.completions.create` / `responses.create` があるファイル

## RITS 側（未実装）

```
POST {RITS_URL}/admin/usage
x-admin-api-key: ...
{ agent_name, model, prompt_tokens, completion_tokens, source, metadata? }
```
