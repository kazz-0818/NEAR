# Veliora / Veriora — スキーマ対応表

組織名の正典は **Veriora**（`veriora` schema）です。レガシー **Veliora**（`veliora` schema）は **削除せず併存**します。Table Editor で両方見えることがあります。

## ざっくり覚え方

| schema | 役割 | 書き込み |
|--------|------|----------|
| **`veriora`** | 組織 OS の正典（UUID・`agent_key`） | アプリから canonical ログ ON 時 |
| **`veliora`** | 旧 LINE イベント（text `agent_code`） | `VERIORA_LEGACY_VELIORA_LINE_LOG=true` 時のみ |
| **`near` / `sera` / `lira`** | 各部署の業務テーブル | 従来どおり |
| **`public`** | RITS 実テーブル + 廃止した互換 VIEW | RITS service_role |

## エージェントマスタ（両方に行がある場合あり）

| オブジェクト | 識別子 | 用途 |
|--------------|--------|------|
| `veriora.ai_agents` | `agent_key`（小文字: `near`, `sera`, …） | **正**。registry・ルーティング・messages FK |
| `veriora.agent_departments` | `department_key` | 部署マスタ |
| `veliora.ai_agents` | `agent_code`（text PK） | **レガシー**。`line_message_events.agent_code` FK |
| `veriora.legacy_veliora_ai_agents` | VIEW | veliora ↔ veriora の突合 |

migration `060` で **5 部署を `veriora.ai_agents` に seed** し、不足分のみ `veliora.ai_agents` に追加します。

## 会話・メッセージ

| 正（書き込み先） | レガシー | 読取 |
|------------------|----------|------|
| `veriora.conversations` | — | `conversation_key` は Veliora 形式互換 |
| `veriora.messages` | `veliora.line_message_events` | `veriora.message_feed`, **`veliora.line_messages` VIEW** |

`veliora.line_messages`（063）は **統合読取 VIEW**（canonical + 未ミラー legacy）。legacy 書き込みを止めても管理 API はこの VIEW 経由で履歴を見られます。

## ルーティング・監査・品質

すべて **`veriora` schema**:

- `agent_routing_logs`, `agent_handoff_logs`, `agent_audit_logs`
- `agent_quality_reviews`, `agent_quality_findings`, `agent_improvement_tasks`

## RITS

| 実テーブル | 互換 VIEW |
|------------|-----------|
| `public.agent_logs` | `veriora.rits_agent_logs_compat` |
| `public.agent_audits` | （直接） |

`DATABASE_URL` + `VERIORA_CANONICAL_LINE_LOG` 時、RITS は `agent_logs` 作成後に **`veriora.messages` へ best-effort 複写**（`src/services/verioraCanonicalLog.ts`）。

## LRAM

正: `veriora.lram_*` テーブル。レガシー `public.lram_*` は compat VIEW 経由。

## env（ログ）

| 変数 | 既定 | 意味 |
|------|------|------|
| `VERIORA_CANONICAL_LINE_LOG` | ON | `veriora.messages` |
| `VERIORA_LEGACY_VELIORA_LINE_LOG` | ON → 検証後 OFF 推奨 | `veliora.line_message_events` |

## やってはいけないこと

- `veliora` / `veriora` schema やテーブルの **DROP**
- 本番で未検証 migration の一括適用
- env キーの **削除のみ** によるリネーム（alias を使う）

## 関連

- [`supabase-schema.md`](supabase-schema.md)
- [`supabase-simplification.md`](supabase-simplification.md)
- [`env-conventions.md`](env-conventions.md) — Phase 3 alias 実装済み
