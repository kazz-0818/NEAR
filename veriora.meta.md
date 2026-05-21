# Veriora マルチリポワークスペース

Cursor で `System/` 以下の複数リポを開いているときの **作業ガイド**。

## 部署（リポ）

| リポ | 部署 | 起動 |
|------|------|------|
| [NEAR](./) | 秘書（総合窓口） | `npm run dev` |
| [../SERA](../SERA) | マーケ | `npm run dev` |
| [../LIRA](../LIRA) | 経理 | FastAPI |
| [../RITS](../RITS) | AI人事（監査） | `npm run dev` |
| [../LRAM](../LRAM) | 編集（BRAVO） | `npm run dev` |

## 正典ドキュメント（NEAR `docs/`）

- [アーキテクチャ](docs/veriora-architecture.md) — Phase 0–8
- [Veliora / Veriora テーブル対応](docs/veliora-veriora-schema-map.md)
- [env 命名 + alias](docs/env-conventions.md)
- [migration 053–063](docs/migration-plan.md)

## 同期検証

```bash
node scripts/verify-veriora-sync.mjs
```

registry / `053_veriora_core_schema.sql` のハッシュが 5 リポで一致することを確認。

## 実装ステータス（このワークスペース）

| Phase | 内容 | 状態 |
|-------|------|------|
| 3 | env alias（全リポ） | コード実装済み |
| 4 | legacy LINE ログ OFF | **運用**（本番 env） |
| 5 | NEAR handoff ヒント → `veriora.agent_handoff_logs` | 実装済み |
| 6 | RITS → `veriora.messages` 複写 | 実装済み（`DATABASE_URL` 要） |
| 7–8 | LRAM 取次ぎ・管理 UI 統一 | 別 PR で拡張可 |

## コミット

**リポごと**にコミットする（NEAR の変更を SERA に混ぜない）。
