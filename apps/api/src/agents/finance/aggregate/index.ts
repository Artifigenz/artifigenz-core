import { db, financeBriefs } from "@artifigenz/db";
import { categorizeAgentInstance, backfillOrphans } from "../categorize";
import { buildDigest, type Digest } from "./digest";
import { generateBriefLLM, type BriefOutput } from "./llm-brief";
import { emit } from "../brief/events";

export interface GenerateResult {
  briefId: string;
  digest: Digest;
  brief: BriefOutput;
}

/**
 * Full brief generation: (re-)categorize new clusters, build the digest,
 * call Claude for the verdict + paragraph, persist to finance_briefs.
 *
 * Emits SSE events keyed by generationId so the frontend can show progress.
 * Phases (kept at 4 for frontend compatibility):
 *   1 — categorize (ensures merchant_clusters is fresh)
 *   2 — build digest
 *   3 — LLM brief
 *   4 — persist
 */
export async function generateAndStoreBrief(
  userId: string,
  agentInstanceId: string,
  generationId?: string,
): Promise<GenerateResult> {
  const id = generationId ?? "";

  emit(id, { type: "progress", phase: 1 });
  await categorizeAgentInstance(agentInstanceId);
  await backfillOrphans(agentInstanceId);

  emit(id, { type: "progress", phase: 2 });
  const digest = await buildDigest(agentInstanceId);

  emit(id, { type: "progress", phase: 3 });
  const brief = await generateBriefLLM(digest);

  emit(id, { type: "progress", phase: 4 });
  const [row] = await db
    .insert(financeBriefs)
    .values({
      userId,
      agentInstanceId,
      verdict: brief.verdict,
      numbers: brief.numbers,
      paragraph: brief.paragraph,
      dataScope: brief.dataScope,
      digestSnapshot: digest as unknown as Record<string, unknown>,
    })
    .returning({ id: financeBriefs.id });

  emit(id, { type: "complete", brief_id: row.id });

  return { briefId: row.id, digest, brief };
}
