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

## 管理 API（Bearer `ADMIN_API_KEY`）

| エンドポイント | 内容 |
|----------------|------|
| `GET /admin/growth-funnel-events?unsupported_id=&limit=` | パイプラインイベント一覧 |
| `GET /admin/growth-candidate-signals` | 実質未解決シグナル |
| `GET /admin/growth-pipeline/summary` | 直近30日の集計（funnel / unsupported ステータス / suggestion 承認状態） |

既存の `GET /admin/unsupported` / `GET /admin/suggestions` と併用する。

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `NEAR_GROWTH_USER_ACK_ENABLED` | オフ | gate 通過時にユーザーへ「改善候補として記録」一文を追加 |
| `NEAR_GROWTH_CANDIDATE_SIGNALS_ENABLED` | オン | `growth_candidate_signals` への記録 |
| `NEAR_GROWTH_FAQ_DEFLECTION_SIGNAL_ENABLED` | オン | FAQ 返答が能力否定・準備中止めのときシグナル化（`source=faq_answerer`） |
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
