# 成長フロー観測（2026-04 追加）

## 問題意識

- **unsupported に落ちない**と従来の `implementation_suggestions` まで進まない（Phase2 でエージェント経路が増えたほど顕著）。
- **gate**（`growth_suggestion_gate.ts`）や **指紋回数** で弾かれても、理由がユーザー・運用から見えにくかった。
- **管理者への第一段階通知**（`notifyGrowthFirstApproval`）がコード上未配線だったため、提案が作られても管理者に届かないことがあった。

## DB

| テーブル | 役割 |
|----------|------|
| `unsupported_requests` | `growth_gate_allow` / `growth_gate_reason` / `growth_gate_evaluated_at` を追加（ゲート結果のスナップショット） |
| `growth_funnel_events` | 段階イベント（`unsupported_recorded` → `growth_gate` → `suggestion_scheduled` → …） |
| `growth_candidate_signals` | unsupported 以外のシグナル（エージェント・レガシー error、**FAQ が「準備中／未対応」系で断った文案** など） |
| `growth_signal_buckets` | 同一種別のシグナルを **bucket_key** で集約（`hit_count`・`priority_score`）。raw 行の「重複排除ビュー」 |

### agent 時代の昇格（2026-04 追記）

- **`NEAR_GROWTH_BUCKET_PROMOTION_ENABLED`** — **未設定時はオン**（明示的に `false` / `0` でオフ）。以前は既定オフだったため、「シグナルは溜まるのに suggestion に一切進まない」原因になりやすかった。
- **`NEAR_GROWTH_PROMOTE_MIN_BUCKET_HITS`** — 既定 **1**（同一バケットで 1 回目から昇格判定）。以前は 2 のため、**2 通目まで昇格しない**ことがあった。
- オン時、`growth_signal_buckets` が閾値を満たすと **合成 `unsupported_requests`**（`entry_source=growth_signal_bucket`）を 1 行作り、**既存と同じ gate → `feature_suggester`** へ進む（`growth_pipeline.ts`）。

### 成長に全然進まないとき（原因追究チェックリスト）

1. **エージェントが先に返している**  
   `NEAR_AGENT_ENABLED` かつ非空テキストで return すると、**従来の unsupported 行は作られない**。対策: シグナル＋バケット昇格（上記）、または `NEAR_AGENT_SHADOW=true` で影モードに戻す、など。

2. **バケット昇格がオフ**  
   Render の env で `NEAR_GROWTH_BUCKET_PROMOTION_ENABLED=false` になっていないか確認（本番で明示的にオフにしているケース）。

3. **ゲートで落ちている**  
   `GET /admin/growth-funnel-events` で `growth_gate` / `growth_promotion_evaluated` の `reason_code`（`message_too_short`, `needs_followup`, `fingerprint_count_*` 等）。`GROWTH_MIN_MESSAGE_CHARS=0` で短文許可、`GROWTH_MIN_FINGERPRINT_COUNT=1` を確認。

4. **DB マイグレーション**  
   `growth_funnel_events` の新カラムや `021` 未適用だと INSERT が失敗し、ログに DB エラーが出る。起動時 `ensureSchema` が走る前提を確認。

5. **OpenAI**  
   `feature_suggester` は `OPENAI_API_KEY` 必須。失敗時は `suggestion_generation_failed`。

6. **エージェント応答に「シグナル理由」がない**  
   ツールも使い、長文で成功っぽい返答だけだと `maybeRecordAgentPathGrowthSignals` は **何も記録しない**。観測用にシグナルを増やすか、意図的に未解決っぽいパターンを試す。

7. **デバッグログ**  
   昇格スキップ理由は `growth_promotion_service` で `log.debug`（ログレベル `debug` 時に表示）。
- ゲートの **fingerprint 件数**は、既定で **`unsupported_requests` + `growth_signal_buckets` の hit（重み付き）**（`GROWTH_FINGERPRINT_INCLUDE_BUCKETS` 等）。
- ファネル: `candidate_signal_recorded` →（昇格時）`growth_bucket_synthetic_unsupported` → `growth_gate` → `suggestion_scheduled` → …。事前ゲート不通過は `growth_promotion_evaluated`（`allowed=false`）。

### 重複排除・優先度・gate との関係（設計）

- **raw 行**（`growth_candidate_signals`）: メッセージ単位の監査ログ。任意で `NEAR_GROWTH_SIGNAL_RAW_DEDUPE_HOURS` により同一 `bucket_key` では raw を抑制できる（抑制時もバケットの `hit_count` は増える）。
- **バケット**（`growth_signal_buckets`）: `bucket_key = hash(channel, messageFingerprint(userText), source, reason_family)`。**ゲート**（`growth_suggestion_gate`）が使う `messageFingerprint(text)` とユーザー発話部分で整合。
- **優先度**（`priority_score` 1〜100）: source・reason の粗いスコア。一覧の並びと、将来の閾値・自動昇格の材料（現状は観測のみ）。
- **gate**（`evaluateGrowthSuggestionEligibility`）: **未対応行（`unsupported_requests`）が既にある前提**で、suggestion 化するかを判定。`GROWTH_MIN_FINGERPRINT_COUNT` は **unsupported の fingerprint 件数**のみカウント（現状）。候補シグナルから **いつでも** suggestion に載せるには、別途「疑似 unsupported」作成または gate の入力にバケット `hit_count` を取り込む拡張が必要（本リリースでは材料蓄積まで）。

## 管理 API（Bearer `ADMIN_API_KEY`）

| エンドポイント | 内容 |
|----------------|------|
| `GET /admin/growth-funnel-events?unsupported_id=&limit=` | パイプラインイベント一覧 |
| `GET /admin/growth-candidate-signals` | 実質未解決シグナル（`bucket_id` / `priority_score` 付き） |
| `GET /admin/growth-signal-buckets` | 集約バケット（優先度・`hit_count`） |
| `GET /admin/growth-pipeline/summary` | 直近30日の集計（funnel / unsupported / suggestion / **バケット件数**） |

既存の `GET /admin/unsupported` / `GET /admin/suggestions` と併用する。

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `NEAR_GROWTH_USER_ACK_ENABLED` | オフ | gate 通過時にユーザーへ「改善候補として記録」一文を追加 |
| `NEAR_GROWTH_CANDIDATE_SIGNALS_ENABLED` | オン | `growth_candidate_signals` への記録 |
| `NEAR_GROWTH_FAQ_DEFLECTION_SIGNAL_ENABLED` | オン | FAQ 返答が能力否定・準備中止めのときシグナル化（`source=faq_answerer`） |
| `NEAR_GROWTH_SIGNAL_RAW_DEDUPE_HOURS` | 0 | 同一 bucket の raw 行を何時間以内に重ねないか。0＝毎回 raw 行も残す |
| `NEAR_GROWTH_ADMIN_NOTIFY_ON_SUGGESTION` | オン | 提案作成後に `notifyGrowthFirstApproval`（管理者 LINE またはグループ） |

## Phase2 との整合

- エージェントが **テキストを返して終了**したケースは `unsupported` にならない。→ **`growth_candidate_signals`** で補助観測。
- 将来は「再質問」「同一 fingerprint の連続」などのシグナルで **未対応行を作らずに成長候補化**する拡張が可能（本テーブルが拡張入口）。

## 典型のどこで止まるか（調査の手順）

1. `GET /admin/growth-pipeline/summary` で `funnel_by_step_and_reason` を見る。  
2. `growth_gate` の `reason_code` が `needs_followup` / `message_too_short` / `fingerprint_count_*` なら **gate 設定**（`GROWTH_*`）を疑う。  
3. `suggestion_rejected_trivial` が多いなら **feature_suggester の LLM 判定**（trivially_infeasible）を疑う。  
4. `admin_first_approval_skipped_no_destination` なら **`ADMIN_LINE_USER_ID` または `GROWTH_APPROVAL_GROUP_ID`** が未設定。  
5. `growth_candidate_signals` でエージェント経路の未解決感を追う。
