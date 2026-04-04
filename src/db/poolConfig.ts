import type { PoolConfig } from "pg";

/**
 * Supabase（pooler / direct）経由では Node の pg が証明書チェーンで失敗することがあるため、
 * supabase.co 接続時は rejectUnauthorized: false を付与する。
 */
export function pgPoolConfig(connectionString: string): PoolConfig {
  const isSupabase =
    connectionString.includes("supabase.co") || connectionString.includes("pooler.supabase.com");
  if (!isSupabase) {
    return { connectionString };
  }
  // 接続文字列の sslmode と ssl オブジェクトが競合すると証明書エラーになることがあるため、
  // Supabase では sslmode を外し、こちらで SSL を指定する。
  const withoutSslMode = connectionString
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/\?$/, "");
  return {
    connectionString: withoutSslMode,
    ssl: { rejectUnauthorized: false },
  };
}
