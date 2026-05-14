# Veriora — 新規 AI エージェント追加チェックリスト

新しい AI エージェント（部署）を追加するときは、以下を **上から順に**確認してください。項目は **必須**と **推奨**に分類しています。

## 1. アイデンティティ（必須）

- [ ] **agent id** を決める（registry の `id`。**ASCII 小文字**、例: `nia`）
- [ ] **code** を決める（表示・ログ用。**大文字**推奨、例: `NIA`）
- [ ] **kana**（カナ表記）を決める
- [ ] **department**（部署名）を決める
- [ ] **displayName**（ユーザー向けの正式表示名）を決める
- [ ] **role**（一文での役割）を決める

## 2. 役割の明文化（必須）

- [ ] **description**（何をする部署か）
- [ ] **primaryResponsibilities**（責務リスト）
- [ ] **outOfScope**（やらないこと・断定しないこと）
- [ ] **handoffRules**（どの部署へいつ渡すか）
- [ ] **allowedActions**（自動でよい範囲）
- [ ] **requiresApprovalActions**（人間承認が必要な範囲）

## 3. プロンプト（必須）

- [ ] **system prompt** ファイルまたはテンプレートを追加（例: `prompts/{id}.system.md` または `src/prompts/`）
- [ ] **systemPromptKey**（registry 上のキー）を `src/agents/registry.ts` / LIRA `app/agents/registry.py` に記載

## 4. 環境変数（必須）

- [ ] 必要なキーを **`.env.example`**（LIRA は `env/*.example` も）に追記（**値は書かない**）
- [ ] 各サービスの **config スキーマ**（Zod / Pydantic）にキーを追加
- [ ] 既存キーと意味が重なる場合は [`env-conventions.md`](env-conventions.md) に従い **alias 方針**を Issue / ドキュメントに起票（Phase 3 で実装）

## 5. Agent registry（必須）

- [ ] TypeScript リポジトリ: `src/agents/registry.ts` の `VERIORA_AGENT_DEFINITIONS` に 1 行追加
- [ ] LIRA: `app/agents/registry.py` に同内容を追加
- [ ] `enabled: true` を確認（カナリーデプロイ時は `false` も可）

## 6. ルーティング / 取次ぎ（推奨）

- [ ] NEAR（総合窓口）からの **振り分けルール**をドキュメント化（コード接続は Phase 5）
- [ ] 他部署への **handoff** 時にユーザーへ見せる文言テンプレを用意

## 7. RITS 監査（推奨）

- [ ] `agent_profiles`（RITS DB）への登録方針を決める（SQL seed または手動）
- [ ] `POST /admin/logs` の `agent_name` / metadata と **registry の `code` を一致**させる運用ルールを README に追記

## 8. ログ保存（推奨）

- [ ] LINE 系: `veliora.line_message_events` への二重記録が必要か（NEAR/SERA パターン）を検討
- [ ] **raw_payload** に PII を入れない方針を確認

## 9. 管理画面・LINE（将来 / Phase 8）

- [ ] 管理画面の一覧に表示する項目（displayName, department, enabled）
- [ ] LINE 表示名（チャネル設定）と registry の整合

## 10. ドキュメント（必須）

- [ ] ルート [`AGENTS.md`](../AGENTS.md) の部署一覧を更新（または veriora-architecture.md の表を更新）
- [ ] 当該リポジトリの `README.md` に **一言追記**

## 11. 本番反映前の確認（必須）

- [ ] `npm run build` / `npm run typecheck` / `pytest` 等が通る
- [ ] **秘密が diff に含まれていない**（`git diff` で確認）
- [ ] DB migration を行う場合は **staging で検証**（本チェックリストだけでは migration 実行を強制しない）

## 参考

- アーキテクチャ: [`veriora-architecture.md`](veriora-architecture.md)
- env: [`env-conventions.md`](env-conventions.md)
- DB: [`db-conventions.md`](db-conventions.md)
