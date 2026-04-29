// src/core/confidence-scorer.ts
// ─────────────────────────────────────────────────────────────
//  3-Tier Confidence Scoring Engine
//
//  The confidence scorer takes a structured extraction result and
//  computes a single 0–1 score that drives the downstream routing:
//
//    Score >= 0.90  → AUTO_APPROVE   (no human needed)
//    Score 0.65–0.89 → HUMAN_REVIEW  (queue for validation)
//    Score <  0.65  → ESCALATE       (block + alert)
//
//  WHY A SEPARATE SCORER?
//  Embedding confidence logic inside each pipeline couples business
//  rules to extraction code.  A standalone scorer lets you swap
//  heuristics, add ML-based scoring, or adjust thresholds globally
//  without touching pipeline logic.
// ─────────────────────────────────────────────────────────────
import { ConfidenceResult, ConfidenceTier } from "../types";
import { config } from "../config";

// ── Scoring signals ──────────────────────────────────────────
//
//  Each signal produces a partial score (0–1) and an optional
//  reason string.  The final score is the weighted mean.

interface Signal {
  name: string;
  weight: number;
  score: number;
  reason?: string;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Score an extracted invoice (or any key-value record).
 *
 * @param extracted  - The structured data returned by the LLM
 * @param required   - Field names that MUST be non-empty
 * @param ragMatched - Whether RAG retrieved supporting context
 */
export function scoreExtraction(
  extracted: Record<string, unknown>,
  required: string[],
  ragMatched: boolean
): ConfidenceResult {
  const signals: Signal[] = [
    fieldCompletenessSignal(extracted, required),
    numericConsistencySignal(extracted),
    dateFormatSignal(extracted),
    ragPresenceSignal(ragMatched),
  ];

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weightedScore =
    signals.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight;

  // Clamp to [0, 1]
  const score = Math.min(1, Math.max(0, weightedScore));
  const tier = resolveTier(score);

  const reasons = signals
    .filter((s) => s.reason)
    .map((s) => `[${s.name}] ${s.reason}`);

  return { score, tier, reasons };
}

/**
 * Manually override a tier — useful in tests or when business
 * rules trump the computed score.
 */
export function buildManualResult(
  score: number,
  reason: string
): ConfidenceResult {
  return {
    score,
    tier: resolveTier(score),
    reasons: [reason],
  };
}

// ── Tier resolver ────────────────────────────────────────────

function resolveTier(score: number): ConfidenceTier {
  if (score >= config.confidence.autoApprove) return "AUTO_APPROVE";
  if (score >= config.confidence.humanReview) return "HUMAN_REVIEW";
  return "ESCALATE";
}

// ── Individual signals ───────────────────────────────────────

/**
 * Signal 1 — Field completeness
 * Are all required fields present and non-empty?
 */
function fieldCompletenessSignal(
  data: Record<string, unknown>,
  required: string[]
): Signal {
  if (required.length === 0) {
    return { name: "field_completeness", weight: 3, score: 1.0 };
  }

  const missing = required.filter((key) => {
    const val = data[key];
    return val === undefined || val === null || val === "";
  });

  const score = 1 - missing.length / required.length;
  return {
    name: "field_completeness",
    weight: 3,
    score,
    reason:
      missing.length > 0
        ? `Missing required fields: ${missing.join(", ")}`
        : undefined,
  };
}

/**
 * Signal 2 — Numeric consistency
 * Do lineItem totals sum to the stated subtotal (within 1%)?
 */
function numericConsistencySignal(data: Record<string, unknown>): Signal {
  try {
    const lineItems = data["lineItems"] as Array<{ total: number }> | undefined;
    const subtotal = data["subtotal"] as number | undefined;

    if (!lineItems || !subtotal || lineItems.length === 0) {
      return { name: "numeric_consistency", weight: 2, score: 0.5,
        reason: "Cannot verify numeric consistency — missing lineItems or subtotal" };
    }

    const computed = lineItems.reduce((sum, li) => sum + (li.total ?? 0), 0);
    const delta = Math.abs(computed - subtotal) / (subtotal || 1);
    const score = delta < 0.01 ? 1.0 : delta < 0.05 ? 0.7 : 0.3;

    return {
      name: "numeric_consistency",
      weight: 2,
      score,
      reason:
        score < 1
          ? `Line-item sum ${computed.toFixed(2)} vs stated subtotal ${subtotal.toFixed(2)} (Δ ${(delta * 100).toFixed(1)}%)`
          : undefined,
    };
  } catch {
    return { name: "numeric_consistency", weight: 2, score: 0.3,
      reason: "Numeric consistency check threw an error" };
  }
}

/**
 * Signal 3 — Date format validity
 * Are issueDate and dueDate valid ISO 8601 dates?
 */
function dateFormatSignal(data: Record<string, unknown>): Signal {
  const dateFields = ["issueDate", "dueDate"];
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  const invalid = dateFields.filter((f) => {
    const val = data[f];
    return typeof val === "string" && !ISO_RE.test(val);
  });

  const score = 1 - invalid.length / dateFields.length;
  return {
    name: "date_format",
    weight: 1,
    score,
    reason:
      invalid.length > 0
        ? `Invalid date format in: ${invalid.join(", ")}`
        : undefined,
  };
}

/**
 * Signal 4 — RAG context presence
 * Did the RAG system find supporting business context?
 * No context → higher chance of hallucination.
 */
function ragPresenceSignal(ragMatched: boolean): Signal {
  return {
    name: "rag_context",
    weight: 1,
    score: ragMatched ? 1.0 : 0.6,
    reason: ragMatched ? undefined : "No RAG context found — extraction is ungrounded",
  };
}
