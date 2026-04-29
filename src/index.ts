// src/index.ts
// ─────────────────────────────────────────────────────────────
//  Demo Runner — runs all pipelines with synthetic documents
//
//  This file is your entry point for `npm run dev`.
//  It wires together every component so you can see the full
//  system working end-to-end without connecting to a real database
//  or file store.
//
//  READING ORDER (for learners):
//    types/index.ts → core/llm-client.ts → tools/index.ts →
//    core/confidence-scorer.ts → core/agent-runner.ts →
//    pipelines/invoice-extraction.ts → rag/* → hitl/escalation.ts
// ─────────────────────────────────────────────────────────────
import "dotenv/config";
import { classifyDocument } from "./pipelines/document-classifier";
import { runInvoiceExtractionPipeline } from "./pipelines/invoice-extraction";
import { chunkDocument } from "./rag/chunker";
import { embedChunks } from "./rag/embedder";
import { RawDocument, EmbeddedChunk } from "./types";

// ── Synthetic documents ──────────────────────────────────────

const sampleInvoice: RawDocument = {
  id: "doc-001",
  source: "uploads/invoice_acme_jun2024.txt",
  content: `
INVOICE

Invoice Number: INV-2024-0099
Issue Date: 2024-06-10
Due Date: 2024-07-10

Vendor: Acme Technology Pte Ltd
Tax ID: 202112345K
Bill To: FintechCo Indonesia PT

Line Items:
  Cloud Infrastructure Setup    1 unit   SGD 8,000.00   SGD 8,000.00
  Security Audit                1 unit   SGD 3,500.00   SGD 3,500.00
  Managed Support (3 months)    3 units  SGD 1,200.00   SGD 3,600.00

Subtotal:  SGD 15,100.00
GST (9%):  SGD  1,359.00
Total:     SGD 16,459.00
Currency: SGD
  `.trim(),
};

const sampleContract: RawDocument = {
  id: "doc-002",
  source: "uploads/msa_acme_2024.txt",
  content: `
MASTER SERVICE AGREEMENT

This Master Service Agreement ("Agreement") is entered into as of 1 June 2024
between Acme Technology Pte Ltd ("Service Provider") and FintechCo Indonesia PT ("Client").

1. SERVICES
   Service Provider agrees to deliver cloud infrastructure, security auditing,
   and managed support services as detailed in Schedule A.

2. PAYMENT TERMS
   Client shall pay all invoices within 30 days of the invoice date.
   Late payments accrue interest at 1.5% per month.

3. TERM
   This Agreement commences on 1 June 2024 and continues for 12 months
   unless terminated earlier in accordance with Section 8.
  `.trim(),
};

// ── Vendor knowledge corpus (for RAG demo) ───────────────────
//  In production this would be loaded from a vector store.
//  Here we build it inline from the MSA document.

async function buildVendorCorpus(): Promise<EmbeddedChunk[]> {
  console.log("\n[Setup] Building vendor knowledge corpus (RAG)…");
  const chunks = chunkDocument(sampleContract.id, sampleContract.content);
  const embedded = await embedChunks(chunks);
  console.log(`[Setup] Corpus ready: ${embedded.length} embedded chunks`);
  return embedded;
}

// ── Demo runs ────────────────────────────────────────────────

async function demoClassification(): Promise<void> {
  console.log("\n" + "═".repeat(60));
  console.log("  DEMO 1 — Document Classification");
  console.log("═".repeat(60));

  for (const doc of [sampleInvoice, sampleContract]) {
    console.log(`\nClassifying "${doc.source}" …`);
    const result = await classifyDocument(doc);
    console.log(`  → docType   : ${result.docType}`);
    console.log(`  → tier      : ${result.classificationConfidence.tier}`);
    console.log(`  → score     : ${result.classificationConfidence.score.toFixed(3)}`);
    console.log(`  → reasons   : ${result.classificationConfidence.reasons.join(" | ") || "none"}`);
  }
}

async function demoInvoiceExtraction(corpus: EmbeddedChunk[]): Promise<void> {
  console.log("\n" + "═".repeat(60));
  console.log("  DEMO 2 — Invoice Extraction Pipeline (with RAG)");
  console.log("═".repeat(60));

  const result = await runInvoiceExtractionPipeline(sampleInvoice, corpus);

  console.log("\n  ── Extracted fields ──");
  console.log(`  invoiceNumber : ${result.extracted.invoiceNumber}`);
  console.log(`  issueDate     : ${result.extracted.issueDate}`);
  console.log(`  dueDate       : ${result.extracted.dueDate}`);
  console.log(`  vendorName    : ${result.extracted.vendorName}`);
  console.log(`  buyerName     : ${result.extracted.buyerName}`);
  console.log(`  subtotal      : ${result.extracted.currency} ${result.extracted.subtotal.toLocaleString()}`);
  console.log(`  taxAmount     : ${result.extracted.currency} ${result.extracted.taxAmount.toLocaleString()}`);
  console.log(`  totalAmount   : ${result.extracted.currency} ${result.extracted.totalAmount.toLocaleString()}`);
  console.log(`  lineItems     : ${result.extracted.lineItems.length} items`);

  console.log("\n  ── Confidence ──");
  console.log(`  score         : ${result.confidence.score.toFixed(3)}`);
  console.log(`  tier          : ${result.confidence.tier}`);
  if (result.confidence.reasons.length > 0) {
    console.log(`  reasons       :`);
    result.confidence.reasons.forEach((r) => console.log(`    • ${r}`));
  }

  if (result.ragContext && result.ragContext.length > 0) {
    console.log("\n  ── RAG Context Used ──");
    result.ragContext.forEach((snippet, i) =>
      console.log(`  [${i + 1}] ${snippet.slice(0, 100)}…`)
    );
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🤖  Agentic Pipeline Demo — GPT-4o + TypeScript");

  if (!process.env.OPENAI_API_KEY) {
    console.error("\n❌ OPENAI_API_KEY is not set. Copy .env.example → .env and add your key.");
    process.exit(1);
  }

  try {
    const corpus = await buildVendorCorpus();
    await demoClassification();
    await demoInvoiceExtraction(corpus);

    console.log("\n✅ Demo complete.\n");
  } catch (err) {
    console.error("\n❌ Demo failed:", err);
    process.exit(1);
  }
}

main();
