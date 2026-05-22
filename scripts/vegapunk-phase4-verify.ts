/**
 * ベガパンク Phase 4 静的検証（DB 書き込みなし）
 *   cd NEAR && npx tsx scripts/vegapunk-phase4-verify.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks: { name: string; ok: boolean; detail?: string }[] = [];

function has(path: string, needle: string): boolean {
  return readFileSync(join(root, path), "utf8").includes(needle);
}

checks.push({
  name: "mergeSuggestions.ts",
  ok: has("src/services/customers/mergeSuggestions.ts", "email_match"),
});
checks.push({
  name: "mergeNotify.ts",
  ok: has("src/services/customers/mergeNotify.ts", "notifyMergeCandidateCreated"),
});
checks.push({
  name: "admin PATCH customers",
  ok: has("src/admin/customerRoutes.ts", 'app.patch("/customers/:id"'),
});
checks.push({
  name: "VERIORA_MERGE_CANDIDATE_NOTIFY env",
  ok: has("src/config/env.ts", "VERIORA_MERGE_CANDIDATE_NOTIFY"),
});

const lramRoot = join(root, "..", "LRAM");
function hasLram(rel: string, needle: string): boolean {
  return readFileSync(join(lramRoot, rel), "utf8").includes(needle);
}
checks.push({
  name: "LRAM customerIdeaRank",
  ok: hasLram("src/modules/article/customerIdeaRank.ts", "rankArticleIdeasByCustomerContext"),
});
checks.push({
  name: "LRAM workflowIdeas context",
  ok: hasLram("src/modules/article/workflow.ts", "customerContextBlock"),
});

const liraMain = readFileSync(join(root, "..", "LIRA", "app", "main.py"), "utf8");
checks.push({
  name: "LIRA /ask → RITS",
  ok: liraMain.includes("send_agent_log_to_rits") && liraMain.includes('source="ask"'),
});

let fail = 0;
for (const c of checks) {
  const mark = c.ok ? "OK" : "NG";
  if (!c.ok) fail++;
  console.log(`[${mark}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (fail > 0) process.exit(1);
console.log(`\nPhase 4 static verify: ${checks.length - fail}/${checks.length} passed`);
