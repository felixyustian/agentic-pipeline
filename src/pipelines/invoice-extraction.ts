// src/pipelines/invoice-extraction.ts
// ─────────────────────────────────────────────────────────────
//  Invoice Extraction Pipeline
//
//  This is the centrepiece pipeline.  It demonstrates how all
//  the system's components work together end-to-end:
//
//    Step 1 — Chunk the invoice text  (RAG prep)
//    Step 2 — Embed chunks            (RAG prep)
//    Step 3 — Retrieve vendor context (RAG query)
//    Step 4 — Re-rank retrieved chunks
//    Step 5 — Extract invoice fields  (GPT-4o + Zod schema)
//    Step 6 — Score confidence        (3-tier engine)
//    Step 7 — Route to HITL if needed
//
//  Running the full pipeline through AgentRunner means every step
//  is timed, logged, and available for post-hoc debugging.
// ─────────────────────────────────────────────────────────────
import { z } from "zod";
import {
  RawDocument,
  InvoiceExtractionResult,
  EmbeddedChunk,
} from "../types";
import { AgentRunner, step } from "../core/agent-runner";
import { callLLMStructured } from "../core/llm-client";
import { scoreExtraction } from "../core/confidence-scorer";
import { chunkDocument } from "../rag/chunker";
import { embedChunks } from "../rag/embedder";
import { retrieve, rerank } from "../rag/retriever";
import { routeEscalation } from "../hitl/escalation";

// ── Zod schema for structured extraction ────────────────────
//  Zod validates the LLM's JSON at runtime, so if the model
//  hallucinates a wrong type you get a clear error — not a
//  silent wrong value downstream.

const LineItemSchema = z.object({
  description: z.string(),
  quantity:    z.number(),
  unitPrice:   z.number(),
  total:       z.number(),
});

const InvoiceSchema = z.object({
  invoiceNumber: z.string(),
  issueDate:     z.string(),
  dueDate:       z.string(),
  vendorName:    z.string(),
  vendorTaxId:   z.string().optional(),
  buyerName:     z.string(),
  lineItems:     z.array(LineItemSchema),
  subtotal:      z.number(),
  taxAmount:     z.number(),
  totalAmount:   z.number(),
  currency:      z.string(),
});

// ── Required fields (used by confidence scorer) ──────────────
const REQUIRED_INVOICE_FIELDS = [
  "invoiceNumber", "issueDate", "dueDate",
  "vendorName", "buyerName", "subtotal",
  "taxAmount", "totalAmount", "currency",
];

// ── Pipeline context — shared across steps ───────────────────
//  Each step receives this context object and enriches it.

interface PipelineContext {
  doc: RawDocument;
  chunks?: EmbeddedChunk[];
  ragContext?: string[];
  ragMatched?: boolean;
  extracted?: z.infer<typeof InvoiceSchema>;
}

// ── Public entry point ───────────────────────────────────────

export async function runInvoiceExtractionPipeline(
  doc: RawDocument,
  // Optional: pre-built corpus for vendor context retrieval
  vendorCorpus: EmbeddedChunk[] = []
): Promise<InvoiceExtractionResult> {
  const runner = new AgentRunner();

  // ── Step definitions ──────────────────────────────────────

  const chunkStep = step<PipelineContext, PipelineContext>(
    "chunk-document",
    async (ctx) => {
      // We chunk the invoice itself so RAG can search within it
      const rawChunks = chunkDocument(ctx.doc.id, ctx.doc.content);
      const embedded = await embedChunks(rawChunks);
      return { ...ctx, chunks: embedded };
    }
  );

  const ragStep = step<PipelineContext, PipelineContext>(
    "rag-retrieve-vendor-context",
    async (ctx) => {
      if (vendorCorpus.length === 0) {
        // No external corpus — skip RAG gracefully
        return { ...ctx, ragContext: [], ragMatched: false };
      }

      // Query: fetch business context matching this invoice's vendor
      const query = `vendor invoice tax ID payment terms ${ctx.doc.content.slice(0, 200)}`;
      const topChunks   = await retrieve(query, vendorCorpus);
      const reranked    = await rerank(query, topChunks);
      const snippets    = reranked.map((c) => c.text);

      return {
        ...ctx,
        ragContext: snippets,
        ragMatched: snippets.length > 0,
      };
    }
  );

  const extractStep = step<PipelineContext, PipelineContext>(
    "gpt4o-extract-invoice",
    async (ctx) => {
      const ragSection =
        ctx.ragContext && ctx.ragContext.length > 0
          ? `\n\n--- RETRIEVED VENDOR CONTEXT ---\n${ctx.ragContext.join("\n---\n")}\n--- END CONTEXT ---`
          : "";

      const systemPrompt = `You are an expert invoice data extraction system for a Southeast Asian fintech platform.
Extract all invoice fields accurately.
Use ISO 8601 for dates (YYYY-MM-DD) and ISO 4217 for currency codes (e.g. IDR, SGD, USD).
If a field is missing from the document write an empty string or 0.
Do NOT guess or hallucinate values — extract only what is explicitly stated.`;

      const userPrompt = `Extract all fields from this invoice.${ragSection}

--- INVOICE ---
${ctx.doc.content}
--- END ---`;

      const extracted = await callLLMStructured({
        systemPrompt,
        userPrompt,
        schema: InvoiceSchema,
        temperature: 0,
      });

      return { ...ctx, extracted };
    }
  );

  const scoreStep = step<PipelineContext, PipelineContext>(
    "confidence-scoring",
    async (ctx) => {
      // scoreExtraction expects a plain record
      const flat = ctx.extracted as unknown as Record<string, unknown>;
      const confidence = scoreExtraction(
        flat,
        REQUIRED_INVOICE_FIELDS,
        ctx.ragMatched ?? false
      );

      runner.setOverallConfidence(confidence);

      // Route low-confidence results to HITL immediately
      if (confidence.tier !== "AUTO_APPROVE") {
        await routeEscalation({
          runId: runner.getRunId(),
          docId: ctx.doc.id,
          reason: confidence.reasons.join("; "),
          confidence,
          timestamp: new Date().toISOString(),
        });
      }

      return ctx;
    }
  );

  // ── Execute pipeline ──────────────────────────────────────

  const { result, run } = await runner.execute<PipelineContext, PipelineContext>(
    [chunkStep, ragStep, extractStep, scoreStep],
    { doc }
  );

  if (!result.extracted) {
    throw new Error("Pipeline completed but no extracted invoice was produced");
  }

  return {
    raw: doc,
    extracted: result.extracted,
    confidence: run.overallConfidence!,
    ragContext: result.ragContext,
  };
}
