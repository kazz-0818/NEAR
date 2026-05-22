# Veriora 共通顧客マスター（ベガパンク）

- LINE `userId` はチャネルごとに別。`customer_identities` で `customers.id` に束ねる。
- 自動 merge しない。`customer_merge_candidates` は人手承認用。
- env: `VERIORA_CUSTOMER_MASTER_ENABLED`（既定 ON）

詳細: [`docs/vegapunk-plan.md`](../../docs/vegapunk-plan.md)
