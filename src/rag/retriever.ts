// src/rag/retriever.ts
// ─────────────────────────────────────────────────────────────
//  Cosine Similarity Retrieval + LLM Re-ranking
//
//  RETRIEVAL PIPELINE
//  ──────────────────
//    1. Embed the query → query vector
//    2. Compute cosine similarity between query vector and every
//       stored chunk embedding
//    3. Return the top-K most similar chunks
//    4. (Optional) Re-rank the top-K using an LLM to remove
//       semantically irrelevant false positives
//
//  WHY RE-RANKING?
//  Embedding similarity is fast but imprecise — it captures
//  topical proximity, not exact relevance.  A second LLM pass
//  (cheaper model, shorter prompt) filters out chunks that are
//  on-topic but not actually useful for the specific query.
// ─────────────────────────────────────────────────────────────
import { EmbeddedChunk, RetrievedChunk } from "../types";
import { embedQuery } from "./embedder";
import { callLLM } from "../core/llm-client";
import { config } from "../config";

// ── Public API ───────────────────────────────────────────────

/**
 * Retrieve the most relevant chunks for a query from a corpus.
 *
 * @param query  - Natural language question or extraction target
 * @param corpus - All embedded chunks available for search
 * @param topK   - Number of chunks to return before re-ranking
 */
export async function retrieve(
  query: string,
  corpus: EmbeddedChunk[],
  topK: number = config.rag.topK
): Promise<RetrievedChunk[]> {
  if (corpus.length === 0) return [];

  const queryEmbedding = await embedQuery(query);

  // Score every chunk
  const scored: RetrievedChunk[] = corpus.map((chunk) => ({
    ...chunk,
    similarityScore: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  // Sort descending, take top-K
  const topChunks = scored
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, topK);

  return topChunks;
}

/**
 * Re-rank retrieved chunks using an LLM.
 * Returns the rerankTopK most relevant chunks.
 */
export async function rerank(
  query: string,
  chunks: RetrievedChunk[],
  rerankTopK: number = config.rag.rerankTopK
): Promise<RetrievedChunk[]> {
  if (chunks.length <= rerankTopK) return chunks;

  const chunkList = chunks
    .map((c, i) => `[${i}] ${c.text.slice(0, 300)}`)
    .join("\n\n");

  const systemPrompt = `You are a relevance judge for a document retrieval system.
Given a query and a list of text chunks (indexed [0], [1], …),
output ONLY a JSON array of the indices of the most relevant chunks,
ordered by relevance (most relevant first).
Return exactly ${rerankTopK} indices.`;

  const userPrompt = `Query: ${query}\n\nChunks:\n${chunkList}`;

  let indices: number[] = [];
  try {
    const raw = await callLLM({
      model: config.cheapModel,   // use cheaper model for re-ranking
      systemPrompt,
      userPrompt,
      temperature: 0,
    });

    // Extract JSON array e.g. [2, 0, 4]
    const match = raw.match(/\[[\d,\s]+\]/);
    if (match) {
      indices = JSON.parse(match[0]) as number[];
    }
  } catch {
    // Fall back to original similarity order if re-ranking fails
    return chunks.slice(0, rerankTopK);
  }

  return indices
    .filter((i) => i >= 0 && i < chunks.length)
    .slice(0, rerankTopK)
    .map((i) => chunks[i] as RetrievedChunk);
}

// ── Cosine similarity ────────────────────────────────────────
//
//  cos(θ) = (A · B) / (|A| × |B|)
//
//  Returns 1.0 for identical vectors, 0.0 for orthogonal (unrelated),
//  and -1.0 for opposite.  OpenAI embeddings are already unit-norm
//  so the denominator is effectively 1 — but we compute it anyway
//  for correctness.

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot   += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
