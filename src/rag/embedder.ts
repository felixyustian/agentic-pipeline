// src/rag/embedder.ts
// ─────────────────────────────────────────────────────────────
//  Embedding Generation — OpenAI text-embedding-3-small
//
//  An embedding is a fixed-length vector of floats that captures
//  the semantic meaning of a piece of text.  Two pieces of text
//  with similar meanings will have vectors that are geometrically
//  close (high cosine similarity).
//
//  We use the embeddings to power semantic search inside the RAG
//  retriever: query → embed query → find closest chunk vectors.
//
//  WHY text-embedding-3-small?
//  It offers the best cost/performance ratio for short documents.
//  Swap to text-embedding-3-large if you need higher accuracy.
// ─────────────────────────────────────────────────────────────
import OpenAI from "openai";
import { Chunk, EmbeddedChunk } from "../types";
import { config } from "../config";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Public API ───────────────────────────────────────────────

/**
 * Generate embeddings for a batch of chunks.
 * OpenAI's embedding endpoint accepts up to 2048 inputs per request.
 */
export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];

  const texts = chunks.map((c) => c.text);

  // Batch in groups of 100 to stay within API limits
  const batchSize = 100;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await openai.embeddings.create({
      model: config.embeddingModel,
      input: batch,
    });

    // OpenAI returns embeddings in the same order as input
    const batchEmbeddings = response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    embeddings.push(...batchEmbeddings);
  }

  return chunks.map((chunk, idx) => ({
    ...chunk,
    embedding: embeddings[idx] ?? [],
  }));
}

/**
 * Embed a single query string.
 * Used at retrieval time to embed the user's query before similarity search.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: config.embeddingModel,
    input: [query],
  });

  return response.data[0]?.embedding ?? [];
}
