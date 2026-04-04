#!/usr/bin/env node
/**
 * Supabase の「直結（Direct）」用 DATABASE_URL をターミナルで組み立てます。
 * ダッシュボードの Connection string が見つからないとき用。
 *
 * 使い方（パスワードはチャットに貼らず、自分のターミナルだけで）:
 *   PGPASSWORD='あなたのDBパスワード' node scripts/supabase-database-url.mjs
 *
 * 接続テストまで:
 *   PGPASSWORD='...' node scripts/supabase-database-url.mjs --test
 *
 * 別プロジェクトのとき:
 *   SUPABASE_PROJECT_REF=xxxx PGPASSWORD='...' node scripts/supabase-database-url.mjs
 */

import pg from "pg";

const ref = process.env.SUPABASE_PROJECT_REF || "jjcosdyimqbxrohbnclz";
const password = process.env.PGPASSWORD;
const test = process.argv.includes("--test");
/** ap-northeast-1 など。直結が DNS 不能な IPv4 環境では Session pooler を使う */
const region = process.env.SUPABASE_REGION || "ap-northeast-1";
const mode = process.env.SUPABASE_URL_MODE || "pooler-session"; // direct | pooler-session

if (!password) {
  console.error("PGPASSWORD が未設定です。");
  console.error(
    "例: PGPASSWORD='（Database のパスワード）' node scripts/supabase-database-url.mjs"
  );
  process.exit(1);
}

const enc = encodeURIComponent(password);
const directUrl = `postgresql://postgres:${enc}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
const poolerUrl = `postgresql://postgres.${ref}:${enc}@aws-0-${region}.pooler.supabase.com:5432/postgres?sslmode=require`;
const url = mode === "direct" ? directUrl : poolerUrl;

console.log("");
console.log(".env に次の1行をコピーしてください:");
console.log(`（モード: ${mode}。リージョン違いのときは SUPABASE_REGION=ap-northeast-2 など）`);
console.log("");
console.log("DATABASE_URL=" + url);
console.log("");

if (test) {
  const pool = new pg.Pool({
    connectionString: url,
    ssl:
      url.includes("supabase.co") || url.includes("pooler.supabase.com")
        ? { rejectUnauthorized: false }
        : undefined,
  });
  try {
    const r = await pool.query("select 1 as ok");
    console.log("接続テスト: OK", r.rows[0]);
  } catch (e) {
    console.error("接続テスト: 失敗");
    console.error(e.message);
    console.error(
      "\nIPv4 の環境では直結が使えないことがあります。その場合は Supabase の Connect で Pooler（Transaction）用 URI を使ってください。"
    );
    process.exit(1);
  } finally {
    await pool.end();
  }
}
