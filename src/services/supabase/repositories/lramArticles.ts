import type { VerioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";

export async function createLramArticleSource(
  db: VerioraDb,
  input: {
    sourceUrl: string;
    sourceSite?: string | null;
    sourceTitle?: string | null;
    brandName?: string | null;
    category?: string | null;
    rawSummary?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.lramArticleSources} (
      source_url, source_site, source_title, brand_name, category, fetched_at, raw_summary, metadata
    ) VALUES ($1,$2,$3,$4,$5, now(), $6, $7::jsonb)
    RETURNING id`,
    [
      input.sourceUrl,
      input.sourceSite ?? null,
      input.sourceTitle ?? null,
      input.brandName ?? null,
      input.category ?? null,
      input.rawSummary ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createLramArticleSource: insert failed");
  return { id };
}

export async function createLramArticleCandidate(
  db: VerioraDb,
  input: {
    sourceId?: string | null;
    agentId?: string | null;
    titleCandidate?: string | null;
    angle?: string | null;
    facts?: Record<string, unknown>;
    bravoViewpoint?: string | null;
    status?: string;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.lramArticleCandidates} (
      source_id, agent_id, title_candidate, angle, facts, bravo_viewpoint, status
    ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
    RETURNING id`,
    [
      input.sourceId ?? null,
      input.agentId ?? null,
      input.titleCandidate ?? null,
      input.angle ?? null,
      JSON.stringify(input.facts ?? {}),
      input.bravoViewpoint ?? null,
      input.status ?? "candidate",
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createLramArticleCandidate: insert failed");
  return { id };
}

export async function createGeneratedArticle(
  db: VerioraDb,
  input: {
    candidateId?: string | null;
    title: string;
    slug?: string | null;
    excerpt?: string | null;
    content: string;
    imagePrompt?: string | null;
    tags?: string[];
    categories?: string[];
    status?: string;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.lramGeneratedArticles} (
      candidate_id, title, slug, excerpt, content, image_prompt, tags, categories, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id`,
    [
      input.candidateId ?? null,
      input.title,
      input.slug ?? null,
      input.excerpt ?? null,
      input.content,
      input.imagePrompt ?? null,
      input.tags ?? [],
      input.categories ?? [],
      input.status ?? "draft",
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createGeneratedArticle: insert failed");
  return { id };
}

export async function saveWordPressPostRecord(
  db: VerioraDb,
  input: {
    generatedArticleId?: string | null;
    wpPostId?: string | null;
    wpPostUrl?: string | null;
    wpStatus?: string | null;
    postedAt?: Date | null;
    metadata?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.lramWpPosts} (
      generated_article_id, wp_post_id, wp_post_url, wp_status, posted_at, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    RETURNING id`,
    [
      input.generatedArticleId ?? null,
      input.wpPostId ?? null,
      input.wpPostUrl ?? null,
      input.wpStatus ?? null,
      input.postedAt ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("saveWordPressPostRecord: insert failed");
  return { id };
}
