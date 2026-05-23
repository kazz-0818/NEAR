#!/usr/bin/env node
/**
 * Veriora 正典の同期検証（registry + core migration + 共有 docs）。
 *
 * 使い方:
 *   node scripts/verify-veriora-sync.mjs           # 兄弟リポが揃っていれば 5 リポ横断
 *   node scripts/verify-veriora-sync.mjs --near-only  # NEAR のみ（CI で兄弟 checkout 不可時）
 *
 * レイアウト: 親ディレクトリに NEAR, SERA, IRIE, RITS, LRAM が並ぶ（System/ 想定）。
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEAR_ROOT = join(__dirname, "..");
const SYSTEM_ROOT = join(NEAR_ROOT, "..");

const args = process.argv.slice(2);
const forceNearOnly = args.includes("--near-only");

const REGISTRY_TS = {
  NEAR: "NEAR/src/agents/registry.ts",
  LRAM: "LRAM/src/agents/registry.ts",
  SERA: "SERA/src/agents/registry.ts",
  RITS: "RITS/src/agents/registry.ts",
};

const REGISTRY_PYTHON = "IRIE/app/agents/registry.py";

const MIGRATION_CANONICAL = "NEAR/src/db/migrations/053_veriora_core_schema.sql";

const SHARED_DOCS = [
  "veriora-architecture.md",
  "env-conventions.md",
  "agent-foldering.md",
  "db-conventions.md",
  "supabase-schema.md",
  "supabase-simplification.md",
  "migration-plan.md",
  "new-agent-checklist.md",
];

const DOC_REPOS = ["NEAR", "SERA", "IRIE", "RITS", "LRAM"];

function sha256(rel) {
  const full = join(SYSTEM_ROOT, rel);
  if (!existsSync(full)) return { path: rel, missing: true };
  const buf = readFileSync(full);
  return {
    path: rel,
    hash: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
}

function hashOf(rel) {
  const r = sha256(rel);
  return r.missing ? null : r.hash;
}

function logEntry(label, name, rel) {
  const r = sha256(rel);
  if (r.missing) {
    console.error(`[${label}] MISSING ${name}: ${rel}`);
    return null;
  }
  console.log(`[${label}] ${name}: ${r.hash.slice(0, 12)}… (${r.bytes} B) ${rel}`);
  return r.hash;
}

function hasSiblingRepo(name) {
  const base = join(SYSTEM_ROOT, name);
  if (name === "IRIE") return existsSync(join(base, "app/agents/registry.py"));
  return existsSync(join(base, "src"));
}

function allSiblingsPresent() {
  return ["SERA", "IRIE", "RITS", "LRAM"].every(hasSiblingRepo);
}

const nearOnly = forceNearOnly || !allSiblingsPresent();
if (nearOnly && !forceNearOnly) {
  console.warn(
    "[verify] 兄弟リポ未検出 → NEAR のみ検証（横断同期はローカル System/ または CI で VERIORA_ORG_CHECKOUT_TOKEN 付き checkout を使用）",
  );
}

let failed = false;

// --- Registry ---
if (nearOnly) {
  const nearHash = logEntry("registry", "NEAR", REGISTRY_TS.NEAR);
  if (!nearHash) failed = true;
  else console.log("[registry] OK — NEAR only mode");
} else {
  const nearHash = logEntry("registry", "NEAR", REGISTRY_TS.NEAR);
  const lramHash = logEntry("registry", "LRAM", REGISTRY_TS.LRAM);
  const seraHash = logEntry("registry", "SERA", REGISTRY_TS.SERA);
  const ritsHash = logEntry("registry", "RITS", REGISTRY_TS.RITS);
  const pyHash = logEntry("registry", "LIRA", REGISTRY_PYTHON);

  if (!nearHash || !lramHash || !seraHash || !ritsHash) failed = true;
  else {
    if (nearHash !== lramHash) {
      console.error("[registry] FAIL: NEAR と LRAM の registry.ts が不一致");
      failed = true;
    }
    if (seraHash !== ritsHash) {
      console.error("[registry] FAIL: SERA と RITS の registry.ts が不一致");
      failed = true;
    }
    if (nearHash !== seraHash) {
      console.log("[registry] OK — TS 2 系統（NEAR≈LRAM, SERA≈RITS）");
    }
  }
  if (logEntry("registry", "LIRA", REGISTRY_PYTHON)) {
    console.log("[registry] LIRA Python は別ファイル（バイト一致は要求しない）");
  }
}

// --- Migration ---
const canon = sha256(MIGRATION_CANONICAL);
if (canon.missing) {
  console.error("[migration] canonical missing:", MIGRATION_CANONICAL);
  failed = true;
} else {
  console.log(`[migration] canonical ${canon.hash.slice(0, 12)}… ${MIGRATION_CANONICAL}`);
  if (!nearOnly) {
    const peers = [
      ["SERA", "SERA/src/db/migrations/016_veriora_core_schema.sql"],
      ["LIRA", "LIRA/docs/supabase/migrations/002_veriora_core_schema.sql"],
      ["RITS", "RITS/rits_schema_migrations/006_veriora_core_schema.sql"],
      ["LRAM", "LRAM/src/modules/supabase/migrations/002_veriora_core_schema.sql"],
    ];
    for (const [name, rel] of peers) {
      const p = sha256(rel);
      if (p.missing) {
        console.error(`[migration] MISSING ${name}: ${rel}`);
        failed = true;
        continue;
      }
      if (p.hash !== canon.hash) {
        console.error(`[migration] FAIL ${name}: ${rel}`);
        failed = true;
      } else {
        console.log(`[migration] OK ${name}`);
      }
    }
  }
}

// --- Shared docs ---
console.log("[docs] NEAR canonical docs");
for (const f of SHARED_DOCS) {
  const canonDoc = `NEAR/docs/${f}`;
  const canonDocHash = hashOf(canonDoc);
  if (!canonDocHash) {
    console.error(`[docs] MISSING ${canonDoc}`);
    failed = true;
    continue;
  }
  if (nearOnly) {
    console.log(`[docs] OK ${f}`);
    continue;
  }
  for (const repo of DOC_REPOS) {
    if (repo === "NEAR") continue;
    const rel = `${repo}/docs/${f}`;
    const h = hashOf(rel);
    if (!h) {
      console.error(`[docs] MISSING ${rel}`);
      failed = true;
    } else if (h !== canonDocHash) {
      console.error(`[docs] DIFF ${rel}`);
      failed = true;
    }
  }
}
if (!failed && !nearOnly) console.log("[docs] OK — all shared docs match NEAR");

if (failed) {
  console.error("\nverify-veriora-sync: FAILED");
  process.exit(1);
}
console.log(`\nverify-veriora-sync: OK${nearOnly ? " (near-only)" : ""}`);
process.exit(0);
