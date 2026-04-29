// src/tools/index.ts
// ─────────────────────────────────────────────────────────────
//  GPT-4o Tool / Function Calling Definitions
//
//  GPT-4o's "tool calling" feature lets the model decide to invoke
//  a predefined function instead of (or alongside) text responses.
//
//  HOW IT WORKS
//  ─────────────
//  1. You pass a `tools` array to the chat completion API.
//  2. When the model thinks a tool is appropriate it returns
//     finish_reason="tool_calls" with a structured JSON payload.
//  3. You execute the real function and send the result back as a
//     "tool" message in the conversation.
//
//  This file defines the *schema* of each tool.  The actual
//  implementation lives alongside the relevant pipeline.
// ─────────────────────────────────────────────────────────────
import type OpenAI from "openai";

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

// ── Tool: classify_document ──────────────────────────────────

export const classifyDocumentTool: Tool = {
  type: "function",
  function: {
    name: "classify_document",
    description:
      "Classify a document into one of the supported categories based on its content.",
    parameters: {
      type: "object",
      properties: {
        docType: {
          type: "string",
          enum: ["invoice", "contract", "kyc", "unknown"],
          description: "The detected document category.",
        },
        confidence: {
          type: "number",
          description:
            "Confidence score from 0.0 (uncertain) to 1.0 (certain).",
          minimum: 0,
          maximum: 1,
        },
        reasoning: {
          type: "string",
          description: "One sentence explaining why this category was chosen.",
        },
      },
      required: ["docType", "confidence", "reasoning"],
    },
  },
};

// ── Tool: extract_invoice ────────────────────────────────────

export const extractInvoiceTool: Tool = {
  type: "function",
  function: {
    name: "extract_invoice",
    description:
      "Extract all structured fields from an invoice document. " +
      "Use ISO 8601 for dates (YYYY-MM-DD) and ISO 4217 for currency codes.",
    parameters: {
      type: "object",
      properties: {
        invoiceNumber:  { type: "string" },
        issueDate:      { type: "string", description: "YYYY-MM-DD" },
        dueDate:        { type: "string", description: "YYYY-MM-DD" },
        vendorName:     { type: "string" },
        vendorTaxId:    { type: "string" },
        buyerName:      { type: "string" },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity:    { type: "number" },
              unitPrice:   { type: "number" },
              total:       { type: "number" },
            },
            required: ["description", "quantity", "unitPrice", "total"],
          },
        },
        subtotal:    { type: "number" },
        taxAmount:   { type: "number" },
        totalAmount: { type: "number" },
        currency:    { type: "string", description: "ISO 4217 code, e.g. IDR" },
      },
      required: [
        "invoiceNumber", "issueDate", "dueDate",
        "vendorName", "buyerName",
        "lineItems", "subtotal", "taxAmount", "totalAmount", "currency",
      ],
    },
  },
};

// ── Tool: flag_for_review ────────────────────────────────────

export const flagForReviewTool: Tool = {
  type: "function",
  function: {
    name: "flag_for_review",
    description:
      "Flag the current extraction for human review when confidence is low " +
      "or data appears inconsistent.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Detailed explanation of why human review is required.",
        },
        severity: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "'high' = block the record; 'medium' = queue for review; 'low' = log only.",
        },
        suspectFields: {
          type: "array",
          items: { type: "string" },
          description: "Field names that appear incorrect or ambiguous.",
        },
      },
      required: ["reason", "severity"],
    },
  },
};

// ── All tools (convenience export) ───────────────────────────

export const allTools: Tool[] = [
  classifyDocumentTool,
  extractInvoiceTool,
  flagForReviewTool,
];
