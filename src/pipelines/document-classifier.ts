// src/pipelines/document-classifier.ts
// ─────────────────────────────────────────────────────────────
//  Document Classification Pipeline
//
//  Given a raw document, this pipeline:
//    1. Sends the content to GPT-4o via tool calling
//    2. The model invokes classify_document() with a structured result
//    3. We map the model's raw confidence → our 3-tier system
//    4. Return a ClassifiedDocument
//
//  WHY TOOL CALLING (not JSON mode)?
//  For classification the model needs to *decide* what to output.
//  Tool calling is more natural for that — the model treats the
//  function signature as a contract, which reduces formatting errors.
// ─────────────────────────────────────────────────────────────
import { ClassifiedDocument, DocumentType, RawDocument } from "../types";
import { callLLMWithTools } from "../core/llm-client";
import { classifyDocumentTool } from "../tools";
import { buildManualResult } from "../core/confidence-scorer";

// ── Public API ───────────────────────────────────────────────

export async function classifyDocument(
  doc: RawDocument
): Promise<ClassifiedDocument> {
  const systemPrompt = `You are a document classification expert for a Southeast Asian fintech platform.
Classify the document into one of:
  - invoice    : A bill for goods/services rendered
  - contract   : A legal agreement between parties
  - kyc        : Know-Your-Customer identity documents
  - unknown    : Anything that does not fit the above

Always call the classify_document function with your result.`;

  const userPrompt = `Document ID: ${doc.id}
Source: ${doc.source ?? "unknown"}

--- DOCUMENT CONTENT ---
${doc.content.slice(0, 4000)}   
--- END ---`;

  const response = await callLLMWithTools({
    systemPrompt,
    userPrompt,
    tools: [classifyDocumentTool],
  });

  // Model called the tool — extract args
  if (typeof response === "object" && response.toolName === "classify_document") {
    const args = response.toolArgs as {
      docType: DocumentType;
      confidence: number;
      reasoning: string;
    };

    return {
      ...doc,
      docType: args.docType,
      classificationConfidence: buildManualResult(
        args.confidence,
        `Model reasoning: ${args.reasoning}`
      ),
    };
  }

  // Fallback if model returned text instead of tool call
  console.warn("[Classifier] Model did not call the tool; defaulting to 'unknown'");
  return {
    ...doc,
    docType: "unknown",
    classificationConfidence: buildManualResult(
      0.3,
      "Model returned text instead of a tool call — classification uncertain"
    ),
  };
}
