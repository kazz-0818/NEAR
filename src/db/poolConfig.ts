import type { PoolConfig } from "pg";

/**
 * 修飾なし `near_inbound_messages` 等は near スキーマを優先（public に同名実テーブルが残ると誤書き込みするため）。
 * マイグレーション SQL は `public.` / `near.` を明示している前提。
 */
const SEARCH_PATH_OPTIONS = "-c search_path=near,public,veliora";

function mergeSearchPathIntoConnectionString(connectionString: string): string {
  const m = connectionString.match(/^(postgres(?:ql)?:\/\/[^?]+)(\?(.*))?$/i);
  if (!m) return connectionString;
  const base = m[1];
  const qs = m[3] ?? "";
  const params = new URLSearchParams(qs);
  const existing = params.get("options") ?? "";
  if (/\bsearch_path\s*=/.test(existing)) {
    return connectionString;
  }
  const merged = existing.trim() ? `${existing} ${SEARCH_PATH_OPTIONS}` : SEARCH_PATH_OPTIONS;
  params.set("options", merged);
  const next = params.toString();
  return next ? `${base}?${next}` : base;
}

/**
 * Supabase（pooler / direct）経由では Node の pg が証明書チェーンで失敗することがあるため、
 * supabase.co 接続時は rejectUnauthorized: false を付与する。
 */
export function pgPoolConfig(connectionString: string): PoolConfig {
  const withSearchPath = mergeSearchPathIntoConnectionString(connectionString);
  const isSupabase =
    withSearchPath.includes("supabase.co") || withSearchPath.includes("pooler.supabase.com");
  if (!isSupabase) {
    return { connectionString: withSearchPath };
  }
  // 接続文字列の sslmode と ssl オブジェクトが競合すると証明書エラーになることがあるため、
  // Supabase では sslmode を外し、こちらで SSL を指定する。
  const withoutSslMode = withSearchPath
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/\?$/, "");
  return {
    connectionString: withoutSslMode,
    ssl: { rejectUnauthorized: false },
  };
}
