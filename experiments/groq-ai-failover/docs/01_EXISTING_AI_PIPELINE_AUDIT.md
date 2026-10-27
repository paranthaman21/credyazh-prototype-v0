# 01 — Existing AI Pipeline Audit

**Document:** `docs/01_EXISTING_AI_PIPELINE_AUDIT.md`  
**Prepared by:** Automated codebase analysis  
**Date:** 2026-10-27  
**Scope:** CredYazh `ai-service/` and `server/src/` as of branch `feature/ai-latency-optimization`

---

## 1. Executive Summary

CredYazh's AI extraction pipeline converts spoken or typed Tamil/Tanglish/English shopkeeper
notes into structured financial transaction drafts. The pipeline is well-engineered with
clear separation of concerns:

- **Deterministic fast path** (regex local extractor) handles ~30–40% of simple transactions in < 2 ms.
- **Gemini model chain** handles complex cases with multi-model fallback.
- **Merchant review gate** ensures no AI-generated data is saved without human confirmation.

**Primary concern:** Gemini HTTP 503 (UNAVAILABLE / overloaded) transient errors cause visible
latency spikes and occasional full extraction failures during peak load periods.

---

## 2. Speech-to-Text Implementation

**Source:** `client/src/recorder.js`

The client records audio using the browser's `MediaRecorder` API and `AudioContext`.

| Aspect | Detail |
|--------|--------|
| Input format | WebM (browser native) |
| Conversion | 16 kHz mono WAV via AudioContext + ScriptProcessorNode |
| Transport | Base64-encoded JSON body to `/api/draft/audio` |
| Secure context guard | Enforced: microphone blocked on non-HTTPS, non-localhost origins |
| STT engine | **Gemini's built-in audio understanding** (NOT a separate Whisper/STT service) |

**Key finding:** Groq's inference models do **not** accept raw audio for extraction; they are text-only.
A separate transcription step (e.g., Groq's `whisper-large-v3`) would be required for voice input
in any Groq failover scenario. Phase 1 evaluates **text-mode extraction only**.

---

## 3. Existing Gemini API Integration

**Source:** `ai-service/main.py`

### 3.1 Client Initialization

```python
_cached_client = None  # module-level singleton

def _client():
    key = os.getenv("GEMINI_API_KEY")
    from google import genai
    _cached_client = genai.Client(api_key=key)
    return _cached_client
```

- Connection is lazy (first request) and cached for the process lifetime.
- FastAPI serves as the API gateway; Uvicorn is the ASGI server.

### 3.2 Model Chain

| Priority | Model | Notes |
|----------|-------|-------|
| 1st (primary) | `gemini-3.5-flash-lite` | Fast, no thinking config support |
| 2nd (fallback) | `gemini-3.5-flash` | Slightly slower, thinking suppressed |
| (render.yaml also lists) | `gemini-3.7-flash`, `gemini-3.8-flash` | Thinking models — too slow for sync extraction, not in default chain |

Default chain is configurable via `GEMINI_MODELS` env var.

### 3.3 Configuration

```python
REQUEST_TIMEOUT_MS = int(os.getenv("GEMINI_REQUEST_TIMEOUT_MS", "10000"))  # 10 s per model
```

- `temperature=0` for deterministic extraction
- `thinking_budget=0` disabled on supported models (saves 400–600 ms)
- `response_mime_type="application/json"` + `response_schema=Draft` for native JSON mode

---

## 4. Extraction Prompt Structure

**Source:** `ai-service/main.py` → `PROMPT` constant

The prompt is a system instruction establishing:

1. **Language handling:** Tamil, Tanglish, English accepted
2. **Transaction classification:** `credit` / `payment` / `combined`
3. **Item extraction:** Name (English), quantity, unit, price (only if spoken)
4. **Safety rule:** "Never fabricate item details if the merchant only stated a purchase amount"
5. **Price rule:** `price_rupees: ONLY if a price for that single item was spoken, otherwise null. Never guess prices.`
6. **Total rule:** `Never add up guessed prices.`
7. **Confidence:** `high` / `medium` / `low`

**Anti-hallucination discipline:** The prompt contains explicit instructions against inventing prices,
amounts, quantities, or customer names. This is the most critical correctness requirement for a
financial application. Any Groq model evaluation must preserve this discipline.

---

## 5. JSON Extraction Schema

**Source:** `ai-service/main.py` → `Draft` Pydantic model

```python
class Item(BaseModel):
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    price_rupees: Optional[float] = None

class Operation(BaseModel):
    type: Literal["payment", "credit"]
    items: list[Item] = []
    total_rupees: Optional[float] = None

class Draft(BaseModel):
    kind: Literal["credit", "payment", "combined"]
    customer_name: str          # Empty string if not heard — never hallucinated
    items: list[Item] = []
    total_rupees: Optional[float] = None
    operations: list[Operation] = []
    transcript: str = ""
    confidence: Literal["high", "medium", "low"]
```

Key constraints normalised downstream in `server/src/validate.js`:
- Rupees → paise (integer arithmetic, no floats)
- `null` total is acceptable (triggers merchant warning)
- Combined transactions require ≥2 operations (payment + credit)

---

## 6. Financial Validation Rules

**Source:** `server/src/validate.js`

| Rule | Implementation |
|------|---------------|
| Amounts converted to integer paise | `Math.round(r * 100)` avoids float errors |
| Max amount cap | Rs 50,000 per operation |
| Anomaly detection | If amount > 5× customer's average, warn merchant |
| Combined must have both payment & credit | Zod schema `superRefine` |
| Missing total triggers warning | `amountWarnings()` function |
| No amount is saved without merchant confirmation | `POST /api/ledger` is the only write endpoint |

---

## 7. Retry and Fallback Behavior

**Source:** `ai-service/main.py` → `_ask()` function

```
Request received
    │
    ├─► Local fast-path extractor (regex, < 2 ms)
    │       └─► If confident → return immediately (no Gemini call)
    │
    └─► Gemini model chain loop:
            Model 1 (primary):
                Success → return
                Transient error (429, 503, 500, 504, UNAVAILABLE, RESOURCE_EXHAUSTED) → next
                Auth error (401, 403) → raise immediately (no point retrying)
                Blocked response → next model
            Model 2 (fallback):
                Success → return
                Any error → log
            All failed → HTTP 502 to Express
```

**Error classification logic:**

```python
_TRANSIENT_HTTP_CODES = {429, 500, 503, 504}
_TRANSIENT_KEYWORDS = ("UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED",
                        "quota", "rate limit", "overloaded")
```

**Key observation:** The fallback chain is **single-provider** (all Gemini). A 503 storm
affecting the Gemini platform simultaneously hits all fallback models, resulting in total
extraction failure despite the retry logic.

---

## 8. Existing Test Coverage

**Source:** `server/test/`

| Test file | Coverage |
|-----------|---------|
| `validate.test.js` | Schema normalisation, paise conversion, amount warnings, 5 acceptance scenarios |
| `customer_routes.test.js` | Customer CRUD, balance isolation |
| `combined_live_api.test.js` | End-to-end combined transaction flow (requires live server + MongoDB) |
| `gemini_latency.test.js` | AI service health, Server-Timing header, metrics payload (requires live AI service) |

**Gap identified:** No adversarial tests for hallucination or ambiguous inputs.
No provider-agnostic extraction accuracy tests. Phase 1 fills this gap.

---

## 9. Known Latency and 503 Failures

**Observations from code and render.yaml:**

| Issue | Root Cause | Frequency |
|-------|-----------|-----------|
| HTTP 503 from Gemini | `UNAVAILABLE` / `overloaded` during high-demand periods | Intermittent |
| Cold-start timeout | First request after Render free-tier sleep (both AI service & Express) | On first daily use |
| 10 s per-model timeout | Occasionally too aggressive on genuine cold starts | Rare |
| Thinking model latency | `gemini-3.7-flash` / `3.8-flash` incur 30–60 s; excluded from default chain | Avoided |

**Render free tier specific:** Services spin down after 15 min of inactivity. First-request
cold start adds 5–15 s per service, compounding AI latency.

---

## 10. Local Fast-Path Extractor

**Source:** `ai-service/credyazh_local_extractor.py`

A regex-based deterministic extractor that avoids Gemini entirely for simple cases:

| Capability | Status |
|-----------|--------|
| Simple credit with amount | Handled |
| Simple repayment | Handled |
| Amount-only credit | Handled |
| Tamil product name mapping | 12 common items mapped |
| Combined transactions | Falls through to Gemini (by design) |
| Multi-amount ambiguity | Falls through to Gemini (by design) |
| Confidence always "medium" | Merchant must confirm all local extractions |

This extractor reduces Gemini load significantly for common patterns and is unaffected
by any Groq experiment.

---

## 11. Audit Conclusions

| Finding | Implication for Groq Evaluation |
|---------|--------------------------------|
| Voice input goes through Gemini's audio understanding | Phase 1 must test text-mode only; audio requires Whisper integration |
| Anti-hallucination rules are explicit in the prompt | Groq models must be tested with the SAME prompt discipline |
| Schema uses Optional fields (null amounts acceptable) | Groq must not fabricate null → number conversions |
| Combined transaction logic is complex | Groq model must handle multi-operation extraction |
| Financial correctness > speed | Acceptance thresholds must weight accuracy over latency |
| 503 failures are provider-level, not model-level | A second provider (Groq) genuinely diversifies the failure domain |

---

*This document was produced from static code analysis. It does not reflect runtime
performance metrics from production. All file references use paths relative to `credyazh/`.*
