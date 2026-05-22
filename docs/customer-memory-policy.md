# 顧客記憶 — プライバシーと保存方針

## 保存してよいもの

- ユーザーが **明示**した呼び名・好み・業務ルール
- 長期に効く回答スタイル・ブランド嗜好（confirmed または低リスク推定）
- 管理者が `customers.memo` に入れたメモ

## 保存しない／避けるもの

- 健康・宗教・政治・性的情報・犯罪歴・詳細住所
- 一時的な雑談・挨拶のみ
- ランダムな推測の断定

実装: `memoryExtractor.ts` の `SENSITIVE_PATTERN` と NEAR `redactSensitiveForMemory`。

## confirmed フラグ

| 値 | 意味 | AI への渡し方 |
|----|------|----------------|
| true | 明示 or 管理者確認 | 事実として扱う |
| false | AI 推測 | 「推定」「未確認」とラベル |

## 削除要求

1. `customers.status = 'deleted'`（論理削除）
2. 関連 `customer_profiles` / `customer_memory_notes` は運用 SQL または将来の admin API で削除
3. `near.near_user_memory` は別途 NEAR 管理 API / DB 操作

秘密情報を `memo` に書かない。admin API は Bearer 保護必須。
