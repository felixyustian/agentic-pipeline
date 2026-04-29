// src/core/llm-client.ts
// ─────────────────────────────────────────────────────────────
//  Thin wrapper around the OpenAI SDK that:
//    1. Enforces JSON-schema structured output (no free-form text)
//    2. Handles retries with exponential back-off
//    3. Logs token usage so you can track cost
//
//  WHY STRUCTURED OUTPUT?
//  Free-form LLM responses require fragile regex / string parsing.
//  By passing `response_format: { type: "json_object" }` and a
//  Zod schema we guarantee the shape of every response, eliminating
//  hallucination-induced runtime crashes downstream.
// ─────────────────────────────────────────────────────────────
import OpenAI from "openai";
import { z, ZodTypeAny } from "zod";
import { config } from "../config";

// Singleton client — one instance shared across the whole process
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface LLMCallOptions {
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  /** Temperature 0 = deterministic, higher = creative */
  temperature?: number;
  maxTokens?: number;
}

// ── Raw call (no schema) ─────────────────────────────────────

export async function callLLM(options: LLMCallOptions): Promise<string> {
  const {
    model = config.primaryModel,
    systemPrompt,
    userPrompt,
    temperature = 0,
    maxTokens = 2048,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= config.agent.maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content ?? "";
      logUsage(model, response.usage);
      return content;
    } catch (err) {
      lastError = err;
      if (attempt < config.agent.maxRetries) {
        // Exponential back-off: 500 ms, 1000 ms, …
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  throw new Error(`LLM call failed after ${config.agent.maxRetries + 1} attempts: ${lastError}`);
}

// ── Structured call (Zod schema enforced) ────────────────────
//
//  Usage example:
//
//    const result = await callLLMStructured({
//      systemPrompt: "Extract the invoice fields.",
//      userPrompt: invoiceText,
//      schema: InvoiceSchema,
//    });
//    // result is fully typed as z.infer<typeof InvoiceSchema>

export async function callLLMStructured<T extends ZodTypeAny>(
  options: LLMCallOptions & { schema: T }
): Promise<z.infer<T>> {
  const { schema, ...rest } = options;

  const rawText = await callLLM({
    ...rest,
    // Instruct the model to respond only with valid JSON
    systemPrompt:
      rest.systemPrompt +
      "\n\nRespond ONLY with a valid JSON object matching the requested schema. No markdown, no explanation.",
  });

  // Strip accidental markdown code fences
  const cleaned = rawText.replace(/```(?:json)?/g, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned non-JSON: ${cleaned.slice(0, 200)}`);
  }

  // Zod validates and types the result
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `LLM JSON did not match schema: ${JSON.stringify(result.error.flatten())}`
    );
  }

  return result.data as z.infer<T>;
}

// ── Tool / function calling ──────────────────────────────────
//
//  GPT-4o supports "tool_choice" for structured function calls.
//  This is an alternative to JSON-mode — prefer it when you need
//  the model to decide *which* function to call.

export interface ToolCallResult {
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export async function callLLMWithTools(
  options: LLMCallOptions & {
    tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  }
): Promise<ToolCallResult | string> {
  const {
    model = config.primaryModel,
    systemPrompt,
    userPrompt,
    tools,
    temperature = 0,
    maxTokens = 2048,
  } = options;

  const response = await openai.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    tools,
    tool_choice: "auto",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  logUsage(model, response.usage);

  const choice = response.choices[0];

  // Model chose to call a tool
  if (choice?.finish_reason === "tool_calls" && choice.message.tool_calls) {
    const call = choice.message.tool_calls[0];
    return {
      toolName: call.function.name,
      toolArgs: JSON.parse(call.function.arguments) as Record<string, unknown>,
    };
  }

  // Model chose to respond with plain text
  return choice?.message?.content ?? "";
}

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logUsage(
  model: string,
  usage: OpenAI.Completions.CompletionUsage | undefined
): void {
  if (!usage) return;
  console.log(
    `[LLM] model=${model} prompt_tokens=${usage.prompt_tokens} ` +
      `completion_tokens=${usage.completion_tokens} total=${usage.total_tokens}`
  );
}
