// src/core/agent-runner.ts
// ─────────────────────────────────────────────────────────────
//  Stateful Multi-Step Agent Orchestrator
//
//  The AgentRunner executes a sequence of named "steps" — each a
//  plain async function — and tracks state, timing, and errors for
//  every step.  This is the backbone that pipelines plug into.
//
//  KEY DESIGN DECISIONS
//  ─────────────────────
//  1. Steps are typed functions, not config strings — TypeScript
//     gives you autocomplete and compile-time safety on step I/O.
//
//  2. State flows forward: each step receives the output of the
//     previous step, enabling linear pipelines without shared
//     mutable globals.
//
//  3. The runner enforces a hard maxSteps cap (config.agent.maxSteps)
//     to prevent infinite agentic loops — a real production risk.
//
//  4. Errors are isolated per step and surfaced in the AgentRun
//     record rather than crashing the process.
// ─────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { AgentRun, AgentStep, ConfidenceResult } from "../types";
import { config } from "../config";

// ── Step definition ──────────────────────────────────────────

export type StepFn<TIn, TOut> = (input: TIn) => Promise<TOut>;

export interface StepDefinition<TIn = unknown, TOut = unknown> {
  name: string;
  fn: StepFn<TIn, TOut>;
}

// ── Runner ───────────────────────────────────────────────────

export class AgentRunner {
  private run: AgentRun;

  constructor() {
    this.run = {
      runId: randomUUID(),
      startedAt: new Date().toISOString(),
      steps: [],
    };
  }

  /**
   * Execute a linear pipeline of steps.
   *
   * The output of step[i] becomes the input of step[i+1].
   * Returns the final output typed as TFinal.
   */
  async execute<TInitial, TFinal>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps: StepDefinition<any, any>[],
    initialInput: TInitial
  ): Promise<{ run: AgentRun; result: TFinal }> {
    if (steps.length > config.agent.maxSteps) {
      throw new Error(
        `Pipeline has ${steps.length} steps but maxSteps=${config.agent.maxSteps}. ` +
          "Increase config.agent.maxSteps or split the pipeline."
      );
    }

    let currentInput: unknown = initialInput;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) break;

      const agentStep: AgentStep = {
        stepIndex: i,
        name: step.name,
        status: "running",
        input: currentInput,
      };

      this.run.steps.push(agentStep);
      const startMs = Date.now();

      try {
        console.log(`[AgentRunner] Step ${i + 1}/${steps.length} — ${step.name}`);
        const output = await step.fn(currentInput);
        agentStep.output = output;
        agentStep.status = "done";
        agentStep.durationMs = Date.now() - startMs;
        currentInput = output;
      } catch (err) {
        agentStep.status = "error";
        agentStep.error = err instanceof Error ? err.message : String(err);
        agentStep.durationMs = Date.now() - startMs;

        this.run.completedAt = new Date().toISOString();
        console.error(`[AgentRunner] Step "${step.name}" failed: ${agentStep.error}`);

        // Surface partial run so callers can inspect what succeeded
        throw new AgentRunError(
          `Step "${step.name}" failed: ${agentStep.error}`,
          this.run
        );
      }
    }

    this.run.finalOutput = currentInput;
    this.run.completedAt = new Date().toISOString();

    const totalMs = this.run.steps.reduce(
      (sum, s) => sum + (s.durationMs ?? 0),
      0
    );
    console.log(
      `[AgentRunner] Run ${this.run.runId} completed in ${totalMs}ms ` +
        `(${steps.length} steps)`
    );

    return { run: this.run, result: currentInput as TFinal };
  }

  /**
   * Attach the overall confidence to the run record.
   * Call this after you have scored the final extraction.
   */
  setOverallConfidence(confidence: ConfidenceResult): void {
    this.run.overallConfidence = confidence;
  }

  getRunRecord(): AgentRun { return this.run; }
  getRunId(): string { return this.run.runId; }
}

// ── Error type ───────────────────────────────────────────────

export class AgentRunError extends Error {
  constructor(message: string, public readonly partialRun: AgentRun) {
    super(message);
    this.name = "AgentRunError";
  }
}

// ── Convenience factory ──────────────────────────────────────

/** Create a typed StepDefinition — purely a readability helper. */
export function step<TIn, TOut>(
  name: string,
  fn: StepFn<TIn, TOut>
): StepDefinition<TIn, TOut> {
  return { name, fn };
}
