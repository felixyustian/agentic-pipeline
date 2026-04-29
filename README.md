# 🤖 Agentic Pipeline System — GPT-4o + TypeScript

A production-grade reference implementation of an **Agentic AI pipeline** built with GPT-4o and TypeScript. This repository mirrors the core architecture of an AI-native SaaS product targeting document processing, compliance, and autonomous decision-making for SEA fintech.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Agent Runner                        │
│  (Orchestrates multi-step reasoning, tool calls, state)  │
└────────────┬──────────────────────────┬─────────────────┘
             │                          │
    ┌────────▼────────┐      ┌──────────▼──────────┐
    │  LLM Client     │      │  Confidence Scorer   │
    │  (GPT-4o calls, │      │  (auto / review /    │
    │  structured out)│      │   escalate tiers)    │
    └────────┬────────┘      └──────────┬──────────┘
             │                          │
    ┌────────▼──────────────────────────▼──────────┐
    │              Pipeline Layer                   │
    │  ┌────────────────┐  ┌──────────────────────┐│
    │  │Invoice Extract │  │ Document Classifier  ││
    │  └────────────────┘  └──────────────────────┘│
    └───────────────────┬───────────────────────────┘
                        │
    ┌───────────────────▼───────────────────────────┐
    │                 RAG System                    │
    │  Chunker → Embedder → Retriever → Re-ranker   │
    └───────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
agentic-pipeline/
├── src/
│   ├── index.ts                   # Demo runner — runs all pipelines
│   ├── config.ts                  # Central config (model, thresholds)
│   ├── types/
│   │   └── index.ts               # Shared TypeScript interfaces
│   ├── core/
│   │   ├── llm-client.ts          # GPT-4o client with structured output
│   │   ├── agent-runner.ts        # Stateful multi-step agent orchestrator
│   │   └── confidence-scorer.ts   # 3-tier confidence scoring engine
│   ├── pipelines/
│   │   ├── invoice-extraction.ts  # Invoice data extraction pipeline
│   │   └── document-classifier.ts # Document classification pipeline
│   ├── rag/
│   │   ├── chunker.ts             # Document chunking strategies
│   │   ├── embedder.ts            # Embedding generation (OpenAI)
│   │   └── retriever.ts           # Cosine similarity retrieval + re-ranking
│   ├── tools/
│   │   └── index.ts               # GPT-4o function/tool definitions
│   ├── hitl/
│   │   └── escalation.ts          # Human-in-the-loop escalation logic
│   └── evaluation/
│       └── benchmark.ts           # Eval framework + regression suite
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 🔑 Core Concepts Demonstrated

| Concept | File | Description |
|---|---|---|
| Multi-step agentic pipeline | `core/agent-runner.ts` | Stateful orchestration with step tracking, timing, and error isolation |
| Structured output enforcement | `core/llm-client.ts` | Zod + JSON Schema validation to eliminate hallucination-induced crashes |
| RAG system | `rag/` | Chunk → embed → retrieve → re-rank |
| Confidence scoring | `core/confidence-scorer.ts` | Auto-approve / human review / escalate tiers driven by multiple signals |
| Tool/function calling | `tools/index.ts` | GPT-4o native function-calling definitions with JSON Schema parameters |
| Human-in-the-loop | `hitl/escalation.ts` | Webhook escalation routing based on confidence thresholds |
| Evaluation framework | `evaluation/benchmark.ts` | Field-level accuracy benchmark runner with regression detection |

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Open .env and set OPENAI_API_KEY=sk-...
```

### 3. Run the demo

```bash
npm run dev
```

### 4. Run evaluation benchmarks

```bash
npm run eval
```

---

## 🔄 Pipeline Flow

```
Input Document
     │
     ▼
[Document Classifier]
     │
     ├─ invoice ──► [Invoice Extraction Pipeline]
     │                    │
     │              [RAG: fetch vendor context]
     │                    │
     │              [GPT-4o structured extraction]
     │                    │
     │              [Confidence Scorer]
     │                    │
     │         ┌──────────┼──────────┐
     │      AUTO-APPROVE  REVIEW   ESCALATE
     │         │          │          │
     │      [Output]  [Queue]   [HITL Alert]
     │
     └─ other ──► [Generic Classification]
```

---

## 🧠 Confidence Tier System

```
Score ≥ 0.90    → AUTO_APPROVE   — Output sent directly to downstream system
Score 0.65–0.89 → HUMAN_REVIEW   — Queued for human validation
Score < 0.65    → ESCALATE       — Blocked; human investigation required
```

The score is a **weighted mean of four signals**:

| Signal | Weight | What it checks |
|---|---|---|
| Field completeness | 3 | Are all required fields present and non-empty? |
| Numeric consistency | 2 | Do line-item totals match the stated subtotal (±1%)? |
| Date format | 1 | Are dates valid ISO 8601 strings? |
| RAG context presence | 1 | Did the RAG system find supporting vendor context? |

---

## 📦 Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20+ | LTS, native `fetch`, good async story |
| Language | TypeScript (strict) | Type safety across the entire pipeline |
| AI Model | GPT-4o / GPT-4o-mini | Structured output + tool calling |
| Embeddings | `text-embedding-3-small` | Best cost/performance for short docs |
| Validation | Zod | Runtime JSON Schema enforcement on LLM output |
| Testing | Vitest | Fast, ESM-friendly unit testing |

---

## 📖 Learning Path

If you are new to agentic systems, read the source files in this order:

1. `types/index.ts` — understand all the data shapes before anything else
2. `core/llm-client.ts` — how GPT-4o is called with structured output and retries
3. `tools/index.ts` — how tool/function calling schemas are defined
4. `core/confidence-scorer.ts` — the 3-tier decision engine and its scoring signals
5. `core/agent-runner.ts` — how steps chain together with timing and error isolation
6. `pipelines/invoice-extraction.ts` — a real end-to-end pipeline using all of the above
7. `rag/` — how the system grounds extractions in business data (chunk → embed → retrieve → rerank)
8. `hitl/escalation.ts` — what happens when the AI is not confident enough
9. `evaluation/benchmark.ts` — how to measure and protect accuracy over time

---

## 🛡️ Production Checklist

Before deploying to production, replace the following stubs:

- [ ] **Vector store** — swap the in-memory corpus in `index.ts` with Pinecone, Weaviate, or pgvector
- [ ] **Review queue** — replace `console.warn` in `hitl/escalation.ts` with SQS / Pub-Sub / your task DB
- [ ] **Webhook** — point `HITL_WEBHOOK_URL` at your real ops platform (Slack, PagerDuty, internal)
- [ ] **Auth** — add API key rotation and rate limiting to the LLM client
- [ ] **Observability** — instrument `agent-runner.ts` with OpenTelemetry spans
