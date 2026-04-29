// src/types/index.ts
// ─────────────────────────────────────────────────────────────
//  All shared data shapes for the agentic pipeline.
//  Read this file first — everything else references these types.
// ─────────────────────────────────────────────────────────────

// ── Confidence scoring ───────────────────────────────────────

export type ConfidenceTier = "AUTO_APPROVE" | "HUMAN_REVIEW" | "ESCALATE";

export interface ConfidenceResult {
  score: number;           // 0.0 – 1.0
  tier: ConfidenceTier;
  reasons: string[];       // human-readable justification
}

// ── Document handling ────────────────────────────────────────

export type DocumentType = "invoice" | "contract" | "kyc" | "unknown";

export interface RawDocument {
  id: string;
  content: string;         // raw text extracted from file
  source?: string;         // filename, S3 key, etc.
  metadata?: Record<string, unknown>;
}

export interface ClassifiedDocument extends RawDocument {
  docType: DocumentType;
  classificationConfidence: ConfidenceResult;
}

// ── Invoice extraction ───────────────────────────────────────

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface ExtractedInvoice {
  invoiceNumber: string;
  issueDate: string;        // ISO 8601
  dueDate: string;          // ISO 8601
  vendorName: string;
  vendorTaxId?: string;
  buyerName: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;         // ISO 4217 e.g. "IDR", "SGD"
}

export interface InvoiceExtractionResult {
  raw: RawDocument;
  extracted: ExtractedInvoice;
  confidence: ConfidenceResult;
  ragContext?: string[];    // snippets retrieved to assist extraction
}

// ── RAG ─────────────────────────────────────────────────────

export interface Chunk {
  id: string;
  documentId: string;
  text: string;
  startChar: number;
  endChar: number;
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export interface RetrievedChunk extends EmbeddedChunk {
  similarityScore: number;
}

// ── Agent runner ─────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "done" | "error";

export interface AgentStep {
  stepIndex: number;
  name: string;
  status: StepStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface AgentRun {
  runId: string;
  startedAt: string;       // ISO 8601
  completedAt?: string;
  steps: AgentStep[];
  finalOutput?: unknown;
  overallConfidence?: ConfidenceResult;
}

// ── HITL escalation ──────────────────────────────────────────

export interface EscalationPayload {
  runId: string;
  docId: string;
  reason: string;
  confidence: ConfidenceResult;
  timestamp: string;
  reviewUrl?: string;
}

// ── Evaluation ───────────────────────────────────────────────

export interface BenchmarkCase {
  id: string;
  description: string;
  input: RawDocument;
  expected: Partial<ExtractedInvoice>;
}

export interface BenchmarkResult {
  caseId: string;
  passed: boolean;
  fieldAccuracy: number;   // 0.0 – 1.0
  durationMs: number;
  errors: string[];
}

export interface BenchmarkSummary {
  totalCases: number;
  passed: number;
  failed: number;
  averageFieldAccuracy: number;
  averageDurationMs: number;
}
