# LINE 無返信（Render コールドスリープ）対策

## 症状と原因

Render 無料プランの Web サービスは 15 分アイドルでスピンダウンする。実測（2026-07-15）:

| サービス | コールド応答 | ウォーム応答 |
|---|---|---|
| NEAR | 23.8s | 1.3s |
| RITS | 22.3s | 0.2s |
| LRAM | 41.4s | 1.2s |
| LIRA (irie) | 24.8s | 1.8s |

※ RITS / LRAM は `render.yaml` 上 `plan: starter` だが、実測ではスリープしていた（実プランが free の可能性。Dashboard 要確認）。NEAR の毎分 Cron（`near-reminder-dispatch`）が効いていればスリープしないはずなので、**Cron が未デプロイまたは停止中の可能性が高い**。

無返信になる経路は 2 つ:

1. **Webhook 消失**: スピンアップ（25〜40 秒）中に LINE 側が Webhook を打ち切る。LINE の「Webhook 再配送」が OFF だとイベント自体が失われる。
2. **reply token 失効**: 再配送・遅延経路では reply token が失効/消費済みになりやすい。reply 専用実装（旧 LIRA / RITS）はここで無言になる。

## 実施した対策（コード）

| リポ | 変更 |
|---|---|
| NEAR | `scripts/render-reminder-dispatch.sh` + `render.yaml`: 毎分 Cron が `VELIORA_WAKE_URLS`（SERA / LIRA / RITS / LRAM の `/health`）も ping し、全サービスを keep-alive |
| LIRA | `app/line_routes.py`: reply 失敗時に push へフォールバック（`_reply_or_push_line`）+ message id 重複排除 |
| RITS | `src/services/ritsService.ts`: reply 失敗時に push フォールバック。`src/routes/lineWebhook.ts`: message id 重複排除 |
| LRAM | `src/server.ts`: message id 重複排除（reply→push フォールバックは実装済みだった） |
| NEAR / SERA | 変更なし（reply→push フォールバックと DB による重複排除が実装済み） |

重複排除は「再配送を ON にすると同一イベントが二重配送され得る」ことへの対で、プロセス内 LRU（Render 1 インスタンス想定）。NEAR / SERA は DB の inbound message id ユニーク制約で対応済み。

## 必要な手動作業（Dashboard / Console）

1. **LINE Developers Console**: 各 Messaging API チャネル（NEAR / SERA / IRIE / RITS / LRAM）で **Webhook 再配送（Redelivery）を ON** にする。スピンアップ中に打ち切られたイベントが再送され、push フォールバックで確実に届く。
2. **Render Dashboard**: `near-reminder-dispatch` Cron が存在し毎分成功しているか確認。無ければ Blueprint を同期して作成し、環境変数 `VELIORA_WAKE_URLS` が入っていることを確認。
3. **プラン確認**: RITS / LRAM の実プランを確認（Blueprint は starter 表記だが実測はスリープ挙動）。

## 注意: 無料インスタンス時間

無料プランの Web を keep-alive で常時ウォームにすると、Render の無料インスタンス時間（月 750 時間 / ワークスペース）を消費し続ける。無料 Web が複数ある場合は月内に上限へ達し、サービスが停止し得る。

- 上限に達する場合: `VELIORA_WAKE_URLS` から優先度の低いサービスを削る
- 恒久対応: LINE 応答が重要なサービスは **starter プランに昇格**（スリープ自体がなくなる）

keep-alive が止まっても、再配送 ON + push フォールバック + 重複排除により「遅れても必ず返信される」状態は維持される。
