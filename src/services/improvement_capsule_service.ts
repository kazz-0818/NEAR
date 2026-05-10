import { randomUUID } from "node:crypto";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import { analyzeImprovementCandidateBatch } from "./improvement_capsule_analyzer.js";
import {
  insertImprovementCapsule,
  listPendingImprovementCandidates,
  markCandidatesStatus,
  updateCapsuleNotified,
} from "./improvement_capsule_repo.js";
import { notifyImprovementCapsuleDigest } from "./admin_notification_service.js";

const BATCH_SIZE = 20;

function filterSourceIds(ids: string[], allowed: Set<string>): string[] {
  return ids.filter((id) => allowed.has(id));
}

export type ImprovementCapsuleJobResult = {
  pendingStart: number;
  batchesRun: number;
  capsulesInserted: number;
  notifiedCapsules: number;
  /** 手動実行かつ候補0件のとき */
  emptyManualMessage?: string;
};

export async function runImprovementCapsuleAnalysisJob(
  db: Db,
  opts: { manual: boolean }
): Promise<ImprovementCapsuleJobResult> {
  const env = getEnv();
  const log = getLogger();
  if (!env.NEAR_IMPROVEMENT_CAPSULES_ENABLED) {
    return { pendingStart: 0, batchesRun: 0, capsulesInserted: 0, notifiedCapsules: 0 };
  }

  const pendingAll = await listPendingImprovementCandidates(db, 10_000);
  const pendingStart = pendingAll.length;
  if (pendingStart === 0) {
    if (opts.manual) {
      return {
        pendingStart: 0,
        batchesRun: 0,
        capsulesInserted: 0,
        notifiedCapsules: 0,
        emptyManualMessage: "改善候補はありませんでした（pending の improvement_candidates は0件です）。",
      };
    }
    return { pendingStart: 0, batchesRun: 0, capsulesInserted: 0, notifiedCapsules: 0 };
  }

  let batchesRun = 0;
  let capsulesInserted = 0;
  const notifyIds: number[] = [];
  const minConf = env.NEAR_IMPROVEMENT_CAPSULE_NOTIFY_MIN_CONFIDENCE;

  while (true) {
    const chunk = await listPendingImprovementCandidates(db, BATCH_SIZE);
    if (chunk.length === 0) break;
    batchesRun++;
    const batchId = randomUUID();
    const allowed = new Set(chunk.map((c) => c.candidate_id));

    let items: Awaited<ReturnType<typeof analyzeImprovementCandidateBatch>> = [];
    try {
      items = await analyzeImprovementCandidateBatch(chunk);
    } catch (e) {
      log.error({ err: e, batchId }, "improvement capsule batch analyze failed");
      await markCandidatesStatus(
        db,
        chunk.map((c) => c.candidate_id),
        "ignored",
        batchId
      );
      continue;
    }

    for (const it of items) {
      let src = filterSourceIds(it.source_candidate_ids, allowed);
      if (src.length === 0) src = chunk.map((c) => c.candidate_id);
      const conf = Number.isFinite(it.confidence) ? it.confidence : 0;
      const id = await insertImprovementCapsule(db, {
        analysisBatchId: batchId,
        problemType: it.problem_type,
        problemSummary: it.problem_summary,
        contextSummary: it.context_summary,
        improvementProposal: it.improvement_proposal,
        suggestedRequirements: it.suggested_requirements ?? [],
        priority: it.priority,
        confidence: conf,
        sourceCandidateIds: src,
        status: conf >= minConf ? "proposed" : "proposed",
      });
      if (id > 0) {
        capsulesInserted++;
        if (conf >= minConf) notifyIds.push(id);
      }
    }

    await markCandidatesStatus(
      db,
      chunk.map((c) => c.candidate_id),
      "analyzed",
      batchId
    );
  }

  let notifiedCapsules = 0;
  if (notifyIds.length > 0) {
    await updateCapsuleNotified(db, notifyIds);
    notifiedCapsules = notifyIds.length;
    await notifyImprovementCapsuleDigest({ db, capsuleIds: notifyIds });
  }

  return { pendingStart, batchesRun, capsulesInserted, notifiedCapsules };
}
