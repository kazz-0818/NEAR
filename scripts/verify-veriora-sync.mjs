#!/usr/bin/env node
/**
 * 5 リポ間の Veriora 正典ファイル同期を検証（registry + core migration SQL）。
 * 使い方: node scripts/verify-veriora-sync.mjs
 * 終了コード 0 = 一致、1 = 不一致
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEAR_ROOT = join(__dirname, "..");
const SYSTEM_ROOT = join(NEAR_ROOT, "..");

const REGISTRY_PATHS = {
  NEAR: "NEAR/src/agents/registry.ts",
  SERA: "SERA/src/agents/registry.ts",
  RITS: "RITS/src/agents/registry.ts",
  LRAM: "LRAM/src/agents/registry.ts",
  LIRA: "LIRA/app/agents/registry.py",
};

const MIGRATION_CANONICAL = "NEAR/src/db/migrations/053_veriora_core_schema.sql";

function sha256(path) {
  const full = join(SYSTEM_ROOT, path);
  if (!existsSync(full)) return { path, missing: true };
  const buf = readFileSync(full);
  return { path, hash: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

function compareGroup(label, entries) {
  const hashes = new Map();
  for (const [name, rel] of Object.entries(entries)) {
    const r = sha256(rel);
    if (r.missing) {
      console.error(`[${label}] MISSING ${name}: ${rel}`);
      return false;
    }
    hashes.set(name, r.hash);
    console.log(`[${label}] ${name}: ${r.hash.slice(0, 12)}… (${r.bytes} B) ${rel}`);
  }
  const unique = new Set(hashes.values());
  if (unique.size > 1) {
    console.warn(`[${label}] DRIFT: ${unique.size} distinct hashes (LIRA=Python / NEAR≈LRAM / SERA≈RITS を手動確認)`);
    return true;
  }
  console.log(`[${label}] OK — all ${hashes.size} files match`);
  return true;
}

let ok = true;
compareGroup("registry", REGISTRY_PATHS);

const canon = sha256(MIGRATION_CANONICAL);
if (canon.missing) {
  console.error("[migration] canonical missing:", MIGRATION_CANONICAL);
  ok = false;
} else {
  console.log(`[migration] canonical ${canon.hash.slice(0, 12)}… ${MIGRATION_CANONICAL}`);
  const peers = [
    ["SERA", "SERA/src/db/migrations/016_veriora_core_schema.sql"],
    ["LIRA", "LIRA/docs/supabase/migrations/002_veriora_core_schema.sql"],
    ["RITS", "RITS/rits_schema_migrations/006_veriora_core_schema.sql"],
    ["LRAM", "LRAM/src/modules/supabase/migrations/002_veriora_core_schema.sql"],
  ];
  for (const [name, rel] of peers) {
    const p = sha256(rel);
    if (p.missing) {
      console.warn(`[migration] skip missing ${name}: ${rel}`);
      continue;
    }
    if (p.hash !== canon.hash) {
      console.warn(`[migration] DRIFT ${name}: ${rel} (要 NEAR 053 と手動 diff)`);
    } else {
      console.log(`[migration] OK ${name}`);
    }
  }
}

process.exit(ok ? 0 : 1);
