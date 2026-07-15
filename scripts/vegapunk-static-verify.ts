#!/usr/bin/env node
/**
 * ベガパンク Phase 1 — 静的検証（DB 不要）
 *   cd NEAR && npm run verify:vegapunk-static
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const system = join(root, "..");

type Check = { name: string; ok: boolean; detail?: string };

const checks: Check[] = [];

/**
 * CI では兄弟リポが無い・checkout 失敗で空ディレクトリだけ残る場合がある
 * （LIRA は IRIE 名でチェックアウトされることもある）。
 * マーカーファイルの存在で「実体のある checkout」かを判定する。
 */
function siblingDir(repo: string): string | null {
  const candidates = repo === "LIRA" ? ["LIRA", "IRIE"] : [repo];
  for (const c of candidates) {
    const base = join(system, c);
    const marker =
      repo === "LIRA" ? join(base, "app/agents/registry.py") : join(base, "package.json");
    if (existsSync(marker)) return c;
  }
  return null;
}

function resolveSiblingPath(rel: string): { path: string; repoPresent: boolean } {
  const [repo, ...rest] = rel.split("/");
  const dir = siblingDir(repo ?? "");
  if (!dir) return { path: join(system, rel), repoPresent: repo === "NEAR" };
  return { path: join(system, dir, rest.join("/")), repoPresent: true };
}

function sha(rel: string): string | null {
  const { path: p } = resolveSiblingPath(rel);
  if (!existsSync(p)) return null;
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function has(path: string, needle: string): boolean {
  return readFileSync(join(root, path), "utf8").includes(needle);
}

function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "[OK]" : "[FAIL]"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const migrationSets: Array<{ label: string; paths: string[] }> = [
  {
    label: "065",
    paths: [
      "NEAR/src/db/migrations/065_veriora_customer_core_tables.sql",
      "SERA/src/db/migrations/027_veriora_customer_core_tables.sql",
      "LIRA/docs/supabase/migrations/013_veriora_customer_core_tables.sql",
      "RITS/rits_schema_migrations/019_veriora_customer_core_tables.sql",
      "LRAM/src/modules/supabase/migrations/015_veriora_customer_core_tables.sql",
    ],
  },
  {
    label: "066",
    paths: [
      "NEAR/src/db/migrations/066_veriora_customer_memory_tables.sql",
      "SERA/src/db/migrations/028_veriora_customer_memory_tables.sql",
      "LIRA/docs/supabase/migrations/014_veriora_customer_memory_tables.sql",
      "RITS/rits_schema_migrations/020_veriora_customer_memory_tables.sql",
      "LRAM/src/modules/supabase/migrations/016_veriora_customer_memory_tables.sql",
    ],
  },
  {
    label: "067",
    paths: [
      "NEAR/src/db/migrations/067_veriora_customer_indexes_rls.sql",
      "SERA/src/db/migrations/029_veriora_customer_indexes_rls.sql",
      "LIRA/docs/supabase/migrations/015_veriora_customer_indexes_rls.sql",
      "RITS/rits_schema_migrations/021_veriora_customer_indexes_rls.sql",
      "LRAM/src/modules/supabase/migrations/017_veriora_customer_indexes_rls.sql",
    ],
  },
  {
    label: "068",
    paths: [
      "NEAR/src/db/migrations/068_veriora_customer_backfill_optional.sql",
      "SERA/src/db/migrations/030_068_veriora_customer_backfill_optional.sql",
      "LIRA/docs/supabase/migrations/016_veriora_customer_backfill_optional.sql",
      "RITS/rits_schema_migrations/022_veriora_customer_backfill_optional.sql",
      "LRAM/src/modules/supabase/migrations/018_veriora_customer_backfill_optional.sql",
    ],
  },
];

for (const set of migrationSets) {
  const hashes = set.paths.map((rel) => ({ rel, h: sha(rel) }));
  const canon = hashes[0]?.h;
  for (const { rel, h } of hashes) {
    const repo = rel.split("/")[0] ?? "";
    if (repo !== "NEAR" && siblingDir(repo) === null) {
      record(`migration ${set.label} ${repo}`, true, "skipped: repo not checked out");
      continue;
    }
    record(`migration ${set.label} ${repo}`, h !== null && h === canon, h?.slice(0, 12) ?? "missing");
  }
}

for (const f of [
  "065_veriora_customer_core_tables.sql",
  "066_veriora_customer_memory_tables.sql",
  "067_veriora_customer_indexes_rls.sql",
  "068_veriora_customer_backfill_optional.sql",
]) {
  record(`ensureSchema ${f}`, has("src/db/ensureSchema.ts", f));
}

for (const f of [
  "customers.ts",
  "customerIdentities.ts",
  "customerProfiles.ts",
  "customerMemoryNotes.ts",
  "customerAgentContexts.ts",
  "customerConversationLinks.ts",
  "customerMergeCandidates.ts",
]) {
  record(`repository ${f}`, existsSync(join(root, "src/services/supabase/repositories", f)));
}

for (const f of [
  "customerRepository.ts",
  "memoryRepository.ts",
  "identityRepository.ts",
  "contextBuilder.ts",
  "memoryExtractor.ts",
  "mergeCandidates.ts",
  "lineResolve.ts",
]) {
  record(`customers/${f}`, existsSync(join(root, "src/services/customers", f)));
}

record("VERIORA_TABLES.customers", has("src/services/supabase/schema.ts", "customers:"));
record("admin customerRoutes", has("src/admin/customerRoutes.ts", 'app.get("/customers/by-identity"'));
record("orchestrator customer context", has("src/services/orchestrator.ts", "buildCustomerContextPromptForAgent") || has("src/services/user_memory_service.ts", "buildCustomerContextPromptForAgent"));
record("user_memory dual-write path", has("src/services/user_memory_service.ts", "buildCustomerContextPromptForAgent"));
record("veliora_line_log linkConversation", has("src/db/veliora_line_log.ts", "linkConversationForAgentKey"));

const docs = [
  "vegapunk-plan.md",
  "customer-master-design.md",
  "customer-identity-linking.md",
  "customer-memory-policy.md",
];
for (const d of docs) {
  record(`docs/${d}`, existsSync(join(root, "docs", d)));
}
record("migration-plan 065-068", has("docs/migration-plan.md", "065_veriora_customer_core_tables"));

function recordSiblingFile(name: string, rel: string, needle?: string): void {
  const repo = rel.split("/")[0] ?? "";
  if (siblingDir(repo) === null) {
    record(name, true, "skipped: repo not checked out");
    return;
  }
  const { path: p } = resolveSiblingPath(rel);
  const exists = existsSync(p);
  record(name, exists && (needle ? readFileSync(p, "utf8").includes(needle) : true));
}

recordSiblingFile("SERA lineResolve", "SERA/src/services/customers/lineResolve.ts");
recordSiblingFile("LRAM handlers customer", "LRAM/src/modules/line/handlers.ts", "buildCustomerContextPromptForAgent");
recordSiblingFile("RITS customerAuditQueries", "RITS/src/services/customerAuditQueries.ts");
recordSiblingFile("LIRA customers/resolve.py", "LIRA/app/customers/resolve.py");

const failed = checks.filter((c) => !c.ok).length;
console.log(`\nPhase 1 static verify: ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
