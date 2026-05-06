# NEAR 秘書アーキテクチャ（設計方針・実装ロードマップ）

NEAR を「intent ルーター」ではなく、**物理行動以外はできるだけ巻き取る AI 秘書**として表現するための全体設計です。裏側は AI + モジュール + 成長フローで成立し、ユーザーからは人間の秘書に近い体験を目指します。

運用上の責務分界（GPT寄りで扱う範囲 / 開発要件に入れる範囲）は [`docs/AI_SCOPE_BOUNDARY.md`](AI_SCOPE_BOUNDARY.md) を基準にします。

---

## 1. 全体アーキテクチャ見直し案

### レイヤー構造（理想形）

```
LINE Webhook
    → 受信保存（inbound）
    → 特別経路（管理者成長 / ユーザー成長 / Google OAuth / デプロイ時刻 / What's new）
    → 【秘書レイヤー】会話文脈を入力に、request_mode を解釈
         ├─ edit_previous_output     → 直前 NEAR 出力の汎用編集（LLM）
         ├─ clarify_missing_info     → 不足情報の自然な確認（LLM）
         ├─ continue_previous_task    → 既存 promote / intent に委譲（段階的拡張）
         ├─ execute_existing_capability / new_request → 従来の intent 分類 + モジュール
         └─ unsupported_growth_candidate → 従来の未対応 + 成長ゲート
    → composeNearReply（必要時）
    → 送信 + outbound 保存
```

### 表と裏

| 表向き（ユーザー体験） | 裏側 |
|------------------------|------|
| 文脈を理解し、頼みを受け止める | `request_interpreter` + `conversation_target_resolver` |
| 直前の返答を直してほしい | `previous_output_editor` |
| 足りないことを聞く | `secretary_clarification_handler` |
| 定型業務（シート・メモ・リマインド等） | 既存 `intent` + `registry` モジュール |
| まだできないこと | `unsupported_requests` + 成長提案 |

### 非目標

- 物理世界での行動（来店、運搬、対面など）はスコープ外と明示する。
- intent を廃止するのではなく、**前段の request_mode で「巻き取り可能な編集・確認」を先に処理**し、ルーターに見えにくくする。

---

## 2. request_mode 導入案

`intent`（どのモジュールか）と別軸に **`request_mode`（今回の依頼の種類）** を置きます。

### request_mode（メタ分類）

| 値 | 意味 |
|----|------|
| `edit_previous_output` | 直前の NEAR 出力（または明確な対象テキスト）に対する編集・整形 |
| `continue_previous_task` | 同じタスクの続き（シート続き質問、前話題の延長など） |
| `clarify_missing_info` | 実行のために確認が必要 |
| `execute_existing_capability` | 既存モジュールで処理すべき明確な依頼 |
| `new_request` | 新規話題・一般的な相談（FAQ 等） |
| `unsupported_growth_candidate` | 自動化・連携が必要で現状モジュール外 |

### 関係

- `request_mode = edit_previous_output` のときでも、裏では `intent` をログ用に `simple_question` 相当として記録してよい（分析用）。
- `continue_previous_task` は当面 **intent 分類 + `promoteGoogleSheetsFollowUp` 等の既存ロジック**にフォールバックし、段階的に強化する。

---

## 3. request_interpreter の設計

**ファイル:** `src/services/request_interpreter.ts`（+ `prompts/request_interpreter.system.md`）

**入力:**

- 今回の `userText`
- `recentUserMessages`（古い順）
- `recentAssistantMessages`（古い順）

**出力（例）:**

- `mode: RequestMode`
- `confidence: number`（0〜1）
- `reasoning?: string`（デバッグ・ログ用）

**挙動:**

- **直近の NEAR 返答が無い**場合は LLM を呼ばず `new_request` を返し、従来フローへ（コスト削減）。
- **ある**場合は構造化 JSON で分類。物理行動依頼は `unsupported_growth_candidate` へ寄せる指示をプロンプトに含める。

**失敗時:** `new_request` にフォールバックし、既存ルートを壊さない。

---

## 4. previous_output_editor の設計

**ファイル:** `src/services/previous_output_editor.ts`

**入力:**

- `targetText`（編集対象＝主に直近の outbound 相当テキスト）
- `instruction`（ユーザーの今回発話）
- 必要なら `recentUserMessages` の要約（省略指示の補完用）

**出力:** 編集後の本文（プレーンテキスト）

**原則:**

- **数値・事実は変えない**（表記・順序・体裁・トーンのみ）。
- スプレッドシートの UI 操作説明に逃げない（FAQ と同趣旨）。
- 温度は低め（一貫性優先）。

---

## 5. conversation_target_resolver の設計

**ファイル:** `src/services/conversation_target_resolver.ts`

**責務:**

- 「これ」「それ」「さっきのやつ」等のとき、**編集対象テキスト**を決める。
- **MVP:** 直近 1 件の `recentAssistantMessages[-1]` をデフォルトの編集対象とする。
- **将来:** メッセージ内にコードブロックや引用がある場合、ユーザーが指すインデックス・「2つ前」などを LLM で解決。

**対象候補（ロードマップ）:**

- 直前の NEAR 返答（実装済み MVP）
- 直前のシート要約（同一テキストとして outbound に残っている）
- メモ・リマインド確認文（outbound に載ったものは同様に対象化可能）

---

## 6. secretary_clarification_handler の設計

**ファイル:** `src/services/secretary_clarification_handler.ts`

**責務:**

- `clarify_missing_info` と判断されたとき、**1〜2 問に絞った自然な確認**を返す。
- すぐ `unsupported` に落とさず、秘書として聞き返す。

**入力:** ユーザーメッセージ + 短い文脈（直近 user / assistant の要約）

**出力:** LINE 用の短い返信テキスト

---

## 7. 既存 orchestrator の変更方針

1. **会話コンテキスト（user + assistant）を intent 分類より前に読み込む**（済んでいる場合はそのまま利用）。
2. **`interpretSecretaryRequest` を `classifyIntent` の直前**に挿入。
3. **短絡ルート:**
   - `edit_previous_output` かつ信頼度しきい値以上 かつ編集対象テキストあり → `previous_output_editor` → `composeNearReply` → 送信・outbound 保存 → **return**（intent モジュールは通さない）。
   - `clarify_missing_info` かつ信頼度しきい値以上 → `secretary_clarification_handler` → 同様に return。
4. **それ以外**は従来どおり `classifyIntent` → `promoteGoogleSheetsFollowUp` → ハンドラ。
5. **`intent_runs`:** 短絡時も `parsed` を合成して保存し、`raw_output` に `secretary_interpretation` を含め分析可能にする。

---

## 8. prompts の変更方針

| 対象 | 方針 |
|------|------|
| `prompts/request_interpreter.system.md` | request_mode 定義・物理不可・編集 vs 新規の判断基準 |
| `prompts/near.persona.md` | NEAR の本質定義（物理以外は巻き取る・確認は最小限）を短く明記 |
| `prompts/intent.system.md` | request_mode と役割分担（編集系は前段で処理されうる）を 1 段落 |
| `faq_answerer` | 「個別 intent 当てはめ」より「文脈で巻き取る」を維持・強化。編集短絡後は FAQ に来ないケースが増える |

---

## 9. MVP 実装順序（推奨）

1. **型とプロンプト** — `RequestMode` / `RequestInterpretation`、interpreter 用 system md  
2. **conversation_target_resolver** — 直近 assistant 1 件の解決  
3. **previous_output_editor** — LLM 編集  
4. **request_interpreter** — LLM メタ分類（assistant 履歴があるときのみ）  
5. **orchestrator 配線** — 上記短絡 + `intent_runs` 記録  
6. **secretary_clarification_handler** — clarify 短絡  
7. **観測** — ログ・`raw_output` で mode 分布を見る  
8. **continue_previous_task の強化** — シート / メモ ID の文脈保持（別テーブル or メタデータ）  
9. **ターゲット解決の多段化** — 「2つ前」「この段落だけ」等  

---

## 10. 既存コードベースへの差分実装案（要約）

| 追加 | 役割 |
|------|------|
| `src/models/requestInterpretation.ts` | Zod + 型エクスポート |
| `src/services/request_interpreter.ts` | メタ分類 |
| `src/services/conversation_target_resolver.ts` | 編集対象テキスト解決 |
| `src/services/previous_output_editor.ts` | 汎用編集 LLM |
| `src/services/secretary_clarification_handler.ts` | 確認文生成 |
| `prompts/request_interpreter.system.md` | 分類プロンプト |
| `src/services/orchestrator.ts` | 読み込み順序 + 短絡分岐 |
| `docs/NEAR_SECRETARY_ARCHITECTURE.md` | 本書 |
| `prompts/near.persona.md` / `intent.system.md` | 本質定義の追記 |

**壊さないための原則:**

- interpreter 失敗・低信頼度は必ず従来フローへ。  
- `NEAR_SECRETARY_LAYER_DISABLED=1` で秘書短絡をオフにできるようにする（任意・推奨）。

---

## 成長フローとの接続

1. 秘書レイヤーで最大限巻き取る  
2. `clarify_missing_info` で聞き返す  
3. それでもモジュール外 → `unsupported_requests` + ゲート  
4. 提案 → 管理者承認 → 成長候補  

「未対応を減らす」は **誤成功ではなく、編集・文脈・確認の強化**で実現する。

---

## NEAR の本質定義（実装・プロンプトの共通原文）

> NEAR は単なる機能ルーターではない。**物理的に身体が要る行動以外**では、考える・整理する・書く・直す・提案する・確認する・進めることを広く引き受ける AI 秘書として振る舞う。できない場合は、人間の秘書のように自然に確認し、それでも足りなければ成長のため記録する。
