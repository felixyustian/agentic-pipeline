// src/rag/chunker.ts
// ─────────────────────────────────────────────────────────────
//  Document Chunking Strategies
//
//  Before we can embed and retrieve document content we must split
//  it into manageable pieces ("chunks").  The chunk size is a
//  trade-off:
//    • Too large  → embeddings lose specificity; retrieval is noisy
//    • Too small  → context is fragmented; re-ranking has less signal
//
//  This module implements fixed-size chunking with configurable
//  overlap (the overlap ensures that sentences split across a
//  boundary are captured in at least one chunk).
// ─────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { Chunk } from "../types";
import { config } from "../config";

// ── Public API ───────────────────────────────────────────────

/**
 * Split a document's text into overlapping fixed-size chunks.
 *
 * @param documentId - ID of the parent document
 * @param text       - Full document text
 * @param chunkSize  - Max chars per chunk (defaults to config)
 * @param overlap    - Overlap chars between adjacent chunks (defaults to config)
 */
export function chunkDocument(
  documentId: string,
  text: string,
  chunkSize: number = config.rag.chunkSize,
  overlap: number = config.rag.chunkOverlap
): Chunk[] {
  if (!text.trim()) return [];

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunkText = text.slice(start, end);

    chunks.push({
      id: randomUUID(),
      documentId,
      text: chunkText,
      startChar: start,
      endChar: end,
    });

    if (end === text.length) break;

    // Move forward by (chunkSize - overlap) to create the overlap window
    start += chunkSize - overlap;
  }

  return chunks;
}

/**
 * Sentence-aware chunker — splits on sentence boundaries first,
 * then groups sentences until the chunk size is reached.
 *
 * Use this for prose-heavy documents (contracts, KYC letters)
 * where splitting mid-sentence hurts embedding quality.
 */
export function chunkBySentence(
  documentId: string,
  text: string,
  targetSize: number = config.rag.chunkSize
): Chunk[] {
  if (!text.trim()) return [];

  // Naive sentence splitter — sufficient for Latin-script fintech docs
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];

  const chunks: Chunk[] = [];
  let buffer = "";
  let bufferStart = 0;
  let cursor = 0;

  for (const sentence of sentences) {
    if (buffer.length + sentence.length > targetSize && buffer.length > 0) {
      chunks.push({
        id: randomUUID(),
        documentId,
        text: buffer.trim(),
        startChar: bufferStart,
        endChar: bufferStart + buffer.length,
      });
      bufferStart = cursor;
      buffer = "";
    }
    buffer += sentence;
    cursor += sentence.length;
  }

  if (buffer.trim()) {
    chunks.push({
      id: randomUUID(),
      documentId,
      text: buffer.trim(),
      startChar: bufferStart,
      endChar: bufferStart + buffer.length,
    });
  }

  return chunks;
}
