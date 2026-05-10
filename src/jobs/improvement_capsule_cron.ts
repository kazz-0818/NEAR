import cron from "node-cron";
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { getLogger } from "../lib/logger.js";
import { runImprovementCapsuleAnalysisJob } from "../services/improvement_capsule_service.js";

export async function dispatchImprovementCapsuleAnalysis(): Promise<void> {
  const log = getLogger();
  const env = getEnv();
  if (!env.NEAR_IMPROVEMENT_CAPSULES_ENABLED) return;
  const pool = getPool();
  try {
    const r = await runImprovementCapsuleAnalysisJob(pool, { manual: false });
    log.info(r, "improvement capsule daily job finished");
  } catch (e) {
    log.error({ err: e }, "improvement capsule daily job failed");
  }
}

export function startImprovementCapsuleCron(): void {
  const log = getLogger();
  const env = getEnv();
  const expr = env.NEAR_IMPROVEMENT_CAPSULE_CRON_EXPR;
  const tz = env.NEAR_IMPROVEMENT_CAPSULE_CRON_TZ;
  cron.schedule(
    expr,
    () => {
      void dispatchImprovementCapsuleAnalysis().catch((e) => log.error({ err: e }, "dispatchImprovementCapsuleAnalysis"));
    },
    { timezone: tz }
  );
  log.info({ expr, tz }, "Improvement capsule cron started");
}
