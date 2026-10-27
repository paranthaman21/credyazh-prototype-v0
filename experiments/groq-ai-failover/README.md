# CredYazh — Groq AI Failover Experiment

> **Status:** Phase 1 — Research & Evaluation  
> **Branch:** `feature/ai-latency-optimization`  
> **Isolation:** This experiment is completely independent of the production Gemini pipeline.

---

## Purpose

CredYazh's existing AI extraction service uses Google Gemini, which has experienced intermittent
**HTTP 503 high-demand errors** under load. This experiment investigates whether
[GroqCloud](https://console.groq.com/) can serve as a reliable independent AI inference
provider for the Tamil/Tanglish transaction extraction task.

This folder contains **all Phase 1 research, test data, scripts, and results**.
Nothing in this folder modifies the existing `server/` or `ai-service/` code paths.

---

## Directory Layout

```
experiments/groq-ai-failover/
│
├── README.md                           <- This file
├── .env.example                        <- Env template (never commit actual keys)
│
├── docs/
│   ├── 01_EXISTING_AI_PIPELINE_AUDIT.md    <- Deep audit of current Gemini pipeline
│   ├── 02_GROQ_MODEL_RESEARCH.md           <- Model selection research
│   ├── 03_TAMIL_TANGLISH_TEST_PLAN.md      <- Evaluation dataset & methodology
│   ├── 04_PHASE1_EVALUATION_REPORT.md      <- Phase 1 decision gate report
│   ├── 05_PHASE2_FAILOVER_DESIGN.md        <- (Pending Phase 2 approval)
│   ├── 06_SECURITY_AND_COST_ANALYSIS.md    <- Security & cost risk assessment
│   └── 07_FINAL_RECOMMENDATION.md         <- (Pending Phase 2 completion)
│
├── datasets/
│   └── sample_transactions.json            <- 40 synthetic Tamil/Tanglish test cases
│
├── scripts/
│   ├── groq_client.py                      <- Standalone Groq API client
│   ├── run_benchmark.py                    <- Phase 1 benchmark runner
│   └── score_results.py                    <- Scoring and report generator
│
├── tests/
│   └── test_groq_extraction.py             <- Offline unit tests (no API calls)
│
└── results/
    └── .gitkeep                            <- Live results written here (gitignored)
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- A GroqCloud API key from [console.groq.com](https://console.groq.com/)
- The existing CredYazh `.venv` **or** a fresh virtual environment

### Setup

```bash
# From repository root (credyazh/)
cd experiments/groq-ai-failover

# Create a local venv (or reuse the ai-service one)
python -m venv .venv
.venv\Scripts\activate          # Windows PowerShell
# source .venv/bin/activate     # Linux / macOS

# Install dependencies
pip install groq pydantic python-dotenv

# Copy and fill in secrets
cp .env.example .env
# Edit .env: set GROQ_API_KEY=gsk_...
```

### Run offline unit tests (no API key required)

```bash
python -m pytest tests/ -v
# or: python tests/test_groq_extraction.py
```

### Run benchmark against real Groq API

```bash
python scripts/run_benchmark.py --model llama-3.3-70b-versatile --limit 40
```

Results are written to `results/benchmark_<model>_<timestamp>.json`.

---

## Phase 1 Decision Gate

After benchmarking, read `docs/04_PHASE1_EVALUATION_REPORT.md` for the outcome:

| Verdict | Meaning |
|---------|---------|
| PASS | Groq is sufficiently accurate. Proceed to Phase 2 failover design. |
| CONDITIONAL PASS | Promising but needs more work. Scope defined in report. |
| FAIL | Not suitable. Report explains why and suggests alternatives. |

**Do not begin Phase 2 implementation without explicit approval from the project lead.**

---

## Safety Rules

- **Never commit `.env` or any file containing `GROQ_API_KEY`.**
- **Never store real merchant transactions or customer names in this folder.**
- **All test data in `datasets/` is synthetic.**
- Production Gemini pipeline is untouched by this experiment.

---

## Relevant Background

| Document | Location |
|----------|----------|
| Existing AI pipeline code | `ai-service/main.py` |
| Extraction schema | `server/src/validate.js` |
| Current failover chain | `ai-service/main.py` → `_ask()` function |
| Architecture overview | `ARCHITECTURE.md` |
