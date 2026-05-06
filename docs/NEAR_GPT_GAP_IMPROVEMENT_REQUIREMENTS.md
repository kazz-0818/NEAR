# NEAR GPT体感差 改善要件

## 背景

ユーザー体感では「GPTなら広く返せるのに、NEARはできない」と見える場面がある。  
主因は、NEARが運用安定性を優先したルーティング構成（intent分類→固定モジュール→未対応記録）を採用しており、自由対話の再探索が毎回は走らないため。

## 原因整理

1. `simple_question` がレガシー FAQ に流れると、回答品質が低いまま返ることがある。
2. その返答が「能力否定っぽい」場合でも、即座に Agent へ再探索する救済経路が弱い。
3. 未対応記録はあるが、同一ターンでの回復（ユーザー体感の改善）より事後改善が先になりやすい。

## 改善方針

### 方針A: その場で巻き取る（一次改善）

- FAQ返答が deflection 判定（能力否定寄り）なら、同ターンで Agent 経路を再試行する。
- Agent の再試行結果が得られたら、それを最終返答として返す。
- Agent 再試行が失敗した場合のみ、従来の成長記録フローに戻す。

### 方針B: 設定で制御可能にする（運用性）

- 環境変数で「FAQ deflection 時の Agent 再試行」をON/OFFできるようにする。
- 既定は ON（改善効果を先に得る）。

## 実装要件

1. `simple_question` の成功返答で deflection 検知した場合、`runNearAgentTurn` を呼ぶ。
2. 再試行が成功（非空テキスト）したら、compose 後に返信し、従来の deflection 応答は返さない。
3. 再試行失敗時は既存挙動を維持（未対応記録・成長パイプラインを壊さない）。
4. `NEAR_AGENT_RETRY_ON_FAQ_DEFLECTION`（true/false）を追加。未設定時は true。
5. 影モード中でも `simple_question` の一部を Agent 優先に寄せる（`NEAR_AGENT_SIMPLE_QUESTION_PRIMARY`）。
6. deflection 以外の「弱いFAQ返答」も Agent 再試行対象にする（`NEAR_AGENT_RETRY_ON_WEAK_FAQ`）。

## 受け入れ条件

- deflection 返答が出るケースで、Agentが有効なら再試行が走ること。
- 再試行成功時、ユーザーへ返る文面が deflection 文面ではないこと。
- 既存の `NEAR_AGENT_ENABLED=false` 環境では挙動が変わらないこと。
- ビルドが通ること。
