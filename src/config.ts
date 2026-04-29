// src/config.ts
// ─────────────────────────────────────────────────────────────
//  Central configuration.  All tuneable knobs live here so that
//  the rest of the codebase never hard-codes magic strings or
//  numbers.
// ─────────────────────────────────────────────────────────────
import "dotenv/config";

export const config = {
  // ── Models ──────────────────────────────────────────────────
  primaryModel: process.env.PRIMARY_MODEL ?? "gpt-4o",
  cheapModel: process.env.CHEAP_MODEL ?? "gpt-4o-mini",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",

  // ── Confidence tiers ────────────────────────────────────────
  // Score >= autoApprove  → AUTO_APPROVE  (sent to downstream)
  // Score >= humanReview  → HUMAN_REVIEW  (queued for a human)
  // Score <  humanReview  → ESCALATE      (blocked, alert fired)
  confidence: {
    autoApprove: Number(process.env.CONFIDENCE_AUTO_APPROVE ?? 0.9),
    humanReview: Number(process.env.CONFIDENCE_HUMAN_REVIEW ?? 0.65),
  },

  // ── RAG ─────────────────────────────────────────────────────
  rag: {
    chunkSize: 512,        // characters per chunk
    chunkOverlap: 64,      // overlap between adjacent chunks
    topK: 5,               // number of chunks to retrieve
    rerankTopK: 3,         // chunks kept after re-ranking
  },

  // ── Agent runner ────────────────────────────────────────────
  agent: {
    maxSteps: 10,          // hard cap on agentic loop iterations
    maxRetries: 2,         // retries on transient LLM errors
  },

  // ── HITL ────────────────────────────────────────────────────
  hitl: {
    webhookUrl:
      process.env.HITL_WEBHOOK_URL ??
      "https://ops.example.com/webhooks/ai-escalation",
  },
} as const;
