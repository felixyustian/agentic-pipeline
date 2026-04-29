// src/hitl/escalation.ts
// ─────────────────────────────────────────────────────────────
//  Human-in-the-Loop (HITL) Escalation
//
//  When the confidence scorer returns HUMAN_REVIEW or ESCALATE,
//  this module fires an alert so an operator can inspect the record.
//
//  ROUTING LOGIC
//  ─────────────
//    AUTO_APPROVE  → nothing to do — record flows to downstream
//    HUMAN_REVIEW  → enqueue in review system + log
//    ESCALATE      → immediate webhook alert + block the record
//
//  In production you would replace the webhook stub with your real
//  ops platform (Slack alert, Jira ticket, internal dashboard, etc.)
// ─────────────────────────────────────────────────────────────
import { EscalationPayload } from "../types";
import { config } from "../config";

// ── Public API ───────────────────────────────────────────────

export async function routeEscalation(
  payload: EscalationPayload
): Promise<void> {
  const { tier } = payload.confidence;

  switch (tier) {
    case "AUTO_APPROVE":
      // Nothing to do — this function should not have been called
      return;

    case "HUMAN_REVIEW":
      await enqueueForReview(payload);
      break;

    case "ESCALATE":
      await fireWebhookAlert(payload);
      break;
  }
}

// ── Review queue ─────────────────────────────────────────────
//
//  In a real system this would push to a database table, SQS queue,
//  or a task management system.  Here we log to stdout.

async function enqueueForReview(payload: EscalationPayload): Promise<void> {
  console.warn(
    `[HITL] ⚠️  HUMAN_REVIEW required for doc=${payload.docId} ` +
      `run=${payload.runId} score=${payload.confidence.score.toFixed(3)}`
  );
  console.warn(`[HITL] Reasons: ${payload.reason}`);

  // TODO: Replace with your queue client e.g.:
  // await sqsClient.sendMessage({ QueueUrl: REVIEW_QUEUE_URL, MessageBody: JSON.stringify(payload) });
}

// ── Webhook alert ────────────────────────────────────────────
//
//  Fires an HTTP POST to the configured HITL webhook URL.
//  Designed for Slack incoming webhooks, PagerDuty, or custom APIs.

async function fireWebhookAlert(payload: EscalationPayload): Promise<void> {
  console.error(
    `[HITL] 🚨 ESCALATION fired for doc=${payload.docId} ` +
      `run=${payload.runId} score=${payload.confidence.score.toFixed(3)}`
  );
  console.error(`[HITL] Reasons: ${payload.reason}`);

  const body = JSON.stringify({
    text: `🚨 *AI Pipeline Escalation*\n` +
      `> *Doc:* ${payload.docId}\n` +
      `> *Run:* ${payload.runId}\n` +
      `> *Score:* ${payload.confidence.score.toFixed(3)}\n` +
      `> *Reason:* ${payload.reason}\n` +
      `> *Time:* ${payload.timestamp}`,
    payload,
  });

  try {
    const response = await fetch(config.hitl.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      console.error(
        `[HITL] Webhook returned ${response.status}: ${await response.text()}`
      );
    }
  } catch (err) {
    // Never let a failed webhook crash the pipeline
    console.error(`[HITL] Webhook delivery failed (non-fatal): ${err}`);
  }
}
