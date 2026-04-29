// src/evaluation/benchmark.ts
// ─────────────────────────────────────────────────────────────
//  Evaluation Framework & Regression Suite
//
//  WHY EVAL?
//  Without systematic measurement, every prompt change is a gamble.
//  This benchmark runner lets you:
//    • Run a fixed set of labelled test cases against the live pipeline
//    • Measure field-level accuracy (not just pass/fail)
//    • Catch regressions before they reach production
//    • Track improvement over time as you tune prompts or models
//
//  HOW ACCURACY IS MEASURED
//  For each benchmark case we compare extracted fields against the
//  expected values.  A field scores 1.0 if it matches exactly, 0.5
//  if it partially matches (numeric within 1%), and 0.0 otherwise.
//  The case-level accuracy is the mean over all compared fields.
// ─────────────────────────────────────────────────────────────
import {
  BenchmarkCase,
  BenchmarkResult,
  BenchmarkSummary,
  ExtractedInvoice,
} from "../types";
import { runInvoiceExtractionPipeline } from "../pipelines/invoice-extraction";

// ── Sample benchmark cases ───────────────────────────────────
//  Replace / extend these with real annotated documents.

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "bench-001",
    description: "Simple SGD invoice, all fields present",
    input: {
      id: "doc-bench-001",
      source: "sample_invoice_sgd.txt",
      content: `INVOICE

Invoice Number: INV-2024-0042
Issue Date: 2024-06-01
Due Date: 2024-06-30

Vendor: Acme Pte Ltd
Tax ID: 201234567A
Bill To: Beta Corp Pte Ltd

ITEMS
Web Design Services    1 unit   SGD 4,000.00   SGD 4,000.00
API Integration        2 units  SGD 800.00     SGD 1,600.00

Subtotal: SGD 5,600.00
GST (9%): SGD 504.00
Total:    SGD 6,104.00
Currency: SGD`,
    },
    expected: {
      invoiceNumber: "INV-2024-0042",
      issueDate: "2024-06-01",
      dueDate: "2024-06-30",
      vendorName: "Acme Pte Ltd",
      buyerName: "Beta Corp Pte Ltd",
      subtotal: 5600,
      taxAmount: 504,
      totalAmount: 6104,
      currency: "SGD",
    },
  },
  {
    id: "bench-002",
    description: "IDR invoice with multiple line items",
    input: {
      id: "doc-bench-002",
      source: "sample_invoice_idr.txt",
      content: `FAKTUR / INVOICE

No. Faktur: INV/2024/07/001
Tanggal Terbit: 2024-07-15
Jatuh Tempo: 2024-08-14

Dari: PT Maju Bersama
NPWP: 01.234.567.8-999.000
Kepada: CV Digital Nusantara

Rincian:
Konsultasi IT    10 jam   Rp 500.000   Rp 5.000.000
Lisensi Software  1 unit  Rp 2.000.000 Rp 2.000.000

Subtotal: Rp 7.000.000
PPN (11%): Rp 770.000
Total: Rp 7.770.000
Mata Uang: IDR`,
    },
    expected: {
      invoiceNumber: "INV/2024/07/001",
      issueDate: "2024-07-15",
      vendorName: "PT Maju Bersama",
      subtotal: 7000000,
      taxAmount: 770000,
      totalAmount: 7770000,
      currency: "IDR",
    },
  },
];

// ── Field comparator ─────────────────────────────────────────

function compareField(
  extracted: unknown,
  expected: unknown
): number {
  if (expected === undefined || expected === null) return 1.0; // not checked

  if (typeof expected === "number" && typeof extracted === "number") {
    const delta = Math.abs(extracted - expected) / (Math.abs(expected) || 1);
    if (delta === 0) return 1.0;
    if (delta <= 0.01) return 0.5; // within 1% — acceptable rounding
    return 0.0;
  }

  if (typeof expected === "string" && typeof extracted === "string") {
    if (extracted.trim() === expected.trim()) return 1.0;
    // Partial credit for substring match (e.g. "Acme" in "Acme Pte Ltd")
    if (extracted.includes(expected) || expected.includes(extracted)) return 0.5;
    return 0.0;
  }

  return extracted === expected ? 1.0 : 0.0;
}

// ── Single case runner ───────────────────────────────────────

async function runCase(c: BenchmarkCase): Promise<BenchmarkResult> {
  const startMs = Date.now();
  const errors: string[] = [];
  let fieldAccuracy = 0;

  try {
    const result = await runInvoiceExtractionPipeline(c.input);
    const extracted = result.extracted as unknown as Record<string, unknown>;
    const expected  = c.expected as Record<string, unknown>;

    const fields = Object.keys(expected);
    const scores = fields.map((f) => compareField(extracted[f], expected[f]));
    fieldAccuracy = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);

    // Flag individual field failures
    fields.forEach((f, i) => {
      if ((scores[i] ?? 0) < 1.0) {
        errors.push(
          `Field "${f}": expected=${JSON.stringify(expected[f])}, got=${JSON.stringify(extracted[f])} (score=${scores[i]?.toFixed(2)})`
        );
      }
    });
  } catch (err) {
    errors.push(`Pipeline threw: ${err instanceof Error ? err.message : String(err)}`);
    fieldAccuracy = 0;
  }

  return {
    caseId: c.id,
    passed: fieldAccuracy >= 0.9 && errors.length === 0,
    fieldAccuracy,
    durationMs: Date.now() - startMs,
    errors,
  };
}

// ── Suite runner ─────────────────────────────────────────────

async function runBenchmarkSuite(): Promise<BenchmarkSummary> {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  Agentic Pipeline — Evaluation Benchmark");
  console.log(`${"═".repeat(60)}\n`);

  const results: BenchmarkResult[] = [];

  for (const c of BENCHMARK_CASES) {
    console.log(`Running case [${c.id}]: ${c.description}`);
    const result = await runCase(c);
    results.push(result);

    const icon = result.passed ? "✅" : "❌";
    console.log(
      `  ${icon} accuracy=${(result.fieldAccuracy * 100).toFixed(1)}% ` +
        `duration=${result.durationMs}ms`
    );
    result.errors.forEach((e) => console.log(`     ⚠ ${e}`));
    console.log();
  }

  const summary: BenchmarkSummary = {
    totalCases:           results.length,
    passed:               results.filter((r) => r.passed).length,
    failed:               results.filter((r) => !r.passed).length,
    averageFieldAccuracy: results.reduce((s, r) => s + r.fieldAccuracy, 0) / results.length,
    averageDurationMs:    results.reduce((s, r) => s + r.durationMs,    0) / results.length,
  };

  console.log(`${"─".repeat(60)}`);
  console.log(`  Results: ${summary.passed}/${summary.totalCases} passed`);
  console.log(`  Avg accuracy : ${(summary.averageFieldAccuracy * 100).toFixed(1)}%`);
  console.log(`  Avg duration : ${summary.averageDurationMs.toFixed(0)}ms`);
  console.log(`${"═".repeat(60)}\n`);

  return summary;
}

// ── Entry point ──────────────────────────────────────────────

runBenchmarkSuite()
  .then((summary) => {
    process.exit(summary.failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("Benchmark crashed:", err);
    process.exit(1);
  });
