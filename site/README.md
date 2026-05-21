# Veriora ショーケースサイト

超近未来スタイルのポートフォリオ用シングルページ。5つの AI エージェント（部署）の能力と進化ログを表示します。**本番 API・LINE・DB には接続しません。**

## ローカル起動

```bash
cd site
npm install
npm run dev
```

ターミナルに表示された **Local:** の URL を開く（多くは http://localhost:5173 ）。

## ビルド

```bash
npm run build
npm run preview   # 本番ビルドのローカル確認
```

成果物は `dist/` に出力されます。

---

## Web 公開（アップロード）

静的サイトなので、**`npm run build` の `dist/` をホスティングする**だけです。おすすめは次のいずれかです。

### 方法 A — GitHub Pages（リポジトリ連携・自動更新）

リポジトリ: `kazz-0818/NEAR`  
ワークフロー: [`.github/workflows/deploy-veriora-site.yml`](../.github/workflows/deploy-veriora-site.yml)

1. **`site/` をコミットして `main` に push**（初回のみ。下記「初回 push」参照）
2. GitHub → **Settings** → **Pages**
3. **Source** を **GitHub Actions** にする
4. `main` に push するとワークフローが走り、数分後に公開されます

**公開 URL（既定）:** `https://kazz-0818.github.io/NEAR/`

#### 初回 push（`site/` がまだ Git に無い場合）

リポジトリルート（`NEAR/`）で:

```bash
git add site/ .github/workflows/deploy-veriora-site.yml
git commit -m "Add Veriora showcase site and GitHub Pages deploy"
git push origin main
```

### 方法 B — Cloudflare Pages（無料・独自ドメイン可）

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create**
2. **Connect to Git** → `kazz-0818/NEAR` を選択
3. 設定:

| 項目 | 値 |
|------|-----|
| Production branch | `main` |
| Root directory | `site` |
| Build command | `npm run build` |
| Build output directory | `dist` |

4. Deploy

`https://xxxx.pages.dev` のような URL が付きます。独自ドメインも後から設定できます。

### 方法 C — Vercel（無料・手軽）

1. [vercel.com](https://vercel.com) → **Add New Project** → GitHub の `NEAR`
2. **Root Directory** を `site` に変更
3. Framework Preset: **Vite**（そのまま Deploy）

[`site/vercel.json`](vercel.json) で SPA のリライト済みです。

### 方法 D — 手動アップロード（FTP 等）

```bash
cd site
npm run build
```

できた **`site/dist/` フォルダの中身** を、レンタルサーバーの `public_html` などに **すべて** アップロードします。

---

## 公開後の更新

1. `src/data/showcase.json` などを編集
2. ローカルで `npm run dev` 確認
3. `git push`（GitHub Pages / Cloudflare / Vercel は自動で再ビルド）

## 能力・進化の更新

編集: **`src/data/showcase.json`**

1. `capabilities` に行を追加（新機能は `"highlight": true` など）
2. `evolutionLog` の先頭に進化ログを追加

カラーは [`src/lib/colors.ts`](src/lib/colors.ts) が正です。

## アイコン

- `public/icons/{NEAR,SERA,...}_ICON.png` / `.webp`
- WebP 再生成: `npm run optimize-icons`

## 技術スタック

Vite + React + TypeScript、Tailwind CSS 4、GSAP、Lenis、React Three Fiber

`prefers-reduced-motion: reduce` では 3D・慣性スクロールを抑えます。
