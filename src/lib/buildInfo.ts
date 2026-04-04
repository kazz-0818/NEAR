import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEnv } from "../config/env.js";

type BuildInfoFile = { builtAt?: string };

function resolveBuildInfoPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const fromDistLib = join(here, "..", "build-info.json");
  if (existsSync(fromDistLib)) return fromDistLib;
  const fromSrcLib = join(here, "..", "..", "dist", "build-info.json");
  if (existsSync(fromSrcLib)) return fromSrcLib;
  return null;
}

function readBuildInfoFile(): string | null {
  try {
    const p = resolveBuildInfoPath();
    if (!p) return null;
    const j = JSON.parse(readFileSync(p, "utf-8")) as BuildInfoFile;
    const iso = j.builtAt?.trim();
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  } catch {
    return null;
  }
}

/**
 * このサーバーイメージがビルドされた時刻（ISO）。
 * `NEAR_BUILT_AT` があれば優先（手動でデプロイ時刻を合わせたいとき用）。
 */
export function getDeployedAtIso(): string | null {
  try {
    const env = getEnv();
    if (env.NEAR_BUILT_AT) return env.NEAR_BUILT_AT;
  } catch {
    /* getEnv 未初期化時はファイルのみ */
  }
  return readBuildInfoFile();
}

/** ユーザー向け: 日本時間の短文 */
export function formatDeployedAtJa(): string | null {
  const iso = getDeployedAtIso();
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** 「いつアップロード／デプロイしたか」系の質問 */
export function isDeployTimeQuestion(text: string): boolean {
  const n = text.normalize("NFKC");
  return (
    (/(アップロード|デプロイ|ビルド|リリース|反映|push)/i.test(n) &&
      /(いつ|何時|把握|知り|教え|記録|時刻|時間|バージョン)/.test(n)) ||
    /最終更新/.test(n) ||
    /いつ.*(上げ|あげ|入れ|反映|更新)/.test(n) ||
    /(サーバー|NEAR|この子).*(いつ|バージョン|更新)/.test(n)
  );
}

/** composeNearReply 用ドラフト（口調は composer に任せる） */
export function buildDeployTimeDraft(): string {
  const jst = formatDeployedAtJa();
  if (!jst) {
    return "ビルド時刻の記録がまだありません。本番では Docker ビルド時に記録されます。開発中は一度 npm run build を実行すると出ます。";
  }
  return `このNEARがビルドされたのは ${jst}（日本時間）です。Git へ push して Render などでデプロイしたタイミングに近い値です。`;
}
