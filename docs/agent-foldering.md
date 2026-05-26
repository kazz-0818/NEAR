# Veliora — エージェント別フォルダ構成

## 理想構成（TypeScript サービス）

```
src/agents/
  index.ts, registry.ts, types.ts
  {agentKey}/
    config.ts    # agentKey, 部署, 使用テーブル, 既存コードへのパス
    prompt.ts    # プロンプト参照
    handler.ts   # 処理エントリ（多くは既存 orchestrator へ委譲）
    routes.ts    # HTTP / admin ルート一覧
    README.md
```

## 既存実装との対応（NEAR）

| agentKey | 既存の主処理 |
|----------|----------------|
| near | `src/services/orchestrator.ts`, `src/modules/` |
| sera | （別リポジトリ SERA） |
| irie | （別リポジトリ IRIE） |
| rits | （別リポジトリ RITS） |
| lram | （別リポジトリ LRAM） |

NEAR リポジトリ内の `src/agents/{key}/` は **ドキュメント + 将来の移行先**。既存 import は変更していません。

## IRIE（Python）

```
app/agents/{agentKey}/config.py
app/agents/{agentKey}/README.md
app/services/supabase/repositories/
```

## 新規エージェント追加

[`new-agent-checklist.md`](new-agent-checklist.md) を参照。
