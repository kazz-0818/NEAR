import type { ParsedIntent } from "../models/intent.js";

export type ImprovementRoutingSnapshot = {
  userText: string;
  parsed: ParsedIntent | null;
  routeTaken: string;
  moduleName: string | null;
  usedLlmFallback: boolean;
  usedGrowthPipeline: boolean;
  /** pre-growth router category when available */
  preGrowthCategory?: string | null;
};

const USER_CORRECTION_PATTERNS =
  /違う|ちがう|そういうことじゃない|そういうことではない|いや、?違う|いや違う|それじゃない|それではない|文脈見て|文脈を見て|なんかおかしい|前に進まない|ちゃんと汲み取って|汲み取って|開発要件じゃない|開発要件ではない|LLMで返せ|LLMに任せ|それ反映して|反映してない|反映されていない/u;

const DEICTIC_REFERENCE_PATTERNS =
  /^(それ|これ|あれ|さっきの|先ほどの|前のやつ|この件|この話|1番|一番|１番|いちばん|1ばん|ひとつめ|一つ目|前の\s*1|前の\s*一)/u;

/** 直近ユーザー文が「似ている」かの粗い判定（短時間言い直し用） */
export function roughSimilarUserUtterances(a: string, b: string): boolean {
  const na = a.normalize("NFKC").replace(/\s+/g, "").slice(0, 80);
  const nb = b.normalize("NFKC").replace(/\s+/g, "").slice(0, 80);
  if (na.length < 6 || nb.length < 6) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const minLen = Math.min(na.length, nb.length);
  let same = 0;
  const lim = Math.min(na.length, nb.length);
  for (let i = 0; i < lim; i++) {
    if (na[i] === nb[i]) same++;
  }
  return same / minLen >= 0.72;
}

export function matchesUserCorrectionSignal(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  return USER_CORRECTION_PATTERNS.test(t);
}

export function matchesDeicticOrContextReference(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t || t.length > 80) return false;
  return DEICTIC_REFERENCE_PATTERNS.test(t) || /前の.*(番|ばん|つ目|個目)/u.test(t);
}

export type RoutingSuspicion =
  | "llm_fallback_on_structured_intent"
  | "growth_pipeline_on_explicit_llmish"
  | "module_unsupported_then_growth";

export function detectRoutingSuspicions(snap: ImprovementRoutingSnapshot): RoutingSuspicion[] {
  const out: RoutingSuspicion[] = [];
  const intent = snap.parsed?.intent;
  const structured =
    intent &&
    intent !== "unknown_custom_request" &&
    intent !== "simple_question" &&
    intent !== "greeting" &&
    intent !== "help_capabilities";

  if (snap.usedLlmFallback && structured) {
    out.push("llm_fallback_on_structured_intent");
  }
  if (snap.usedGrowthPipeline && snap.preGrowthCategory === "external_realtime_answer") {
    out.push("growth_pipeline_on_explicit_llmish");
  }
  if (snap.routeTaken === "legacy_module" && snap.usedGrowthPipeline) {
    out.push("module_unsupported_then_growth");
  }
  return out;
}

export type CandidateRuleHit = {
  triggerReason: string;
  /** 人間可読の短いラベル */
  label: string;
};

/**
 * 軽量ルールで候補理由を列挙（LLM は呼ばない）。
 * DB 参照が必要な「短時間言い直し」は呼び出し側で別途マージする。
 */
export function collectLocalRuleHits(text: string, snap: ImprovementRoutingSnapshot): CandidateRuleHit[] {
  const hits: CandidateRuleHit[] = [];
  if (matchesUserCorrectionSignal(text)) {
    hits.push({ triggerReason: "user_correction_signal", label: "ユーザー否定・修正の語" });
  }
  if (matchesDeicticOrContextReference(text)) {
    hits.push({ triggerReason: "deictic_or_context_reference", label: "直前文脈参照っぽい短文" });
  }
  for (const r of detectRoutingSuspicions(snap)) {
    hits.push({ triggerReason: `routing:${r}`, label: `ルーティング:${r}` });
  }
  return hits;
}
