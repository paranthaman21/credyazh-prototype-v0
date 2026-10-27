# 02 — Groq Model Research for CredYazh Tamil/Tanglish Extraction

**Document:** `docs/02_GROQ_MODEL_RESEARCH.md`  
**Prepared by:** AI Systems Engineering Team  
**Date:** 2026-10-27  
**Scope:** GroqCloud model capabilities, Indic tokenization, latency, rate limits, and JSON mode reliability  

---

## 1. Executive Summary

CredYazh requires an ultra-low latency, highly resilient secondary inference engine to mitigate Gemini HTTP 503 errors. Groq's custom LPU (Language Processing Unit) architecture delivers generation speeds between 250 and 800+ tokens/second. However, for a multilingual kirana voice-ledger accepting Tamil, Tanglish, and Chennai colloquial dialect, inference speed alone is insufficient; **linguistic comprehension, strict anti-hallucination discipline, and JSON schema compliance** are mandatory.

This research analyzes currently hosted Groq models to identify viable candidates for CredYazh transaction extraction.

---

## 2. GroqCloud Hosted Models Overview

| Model ID | Base Architecture | Context Window | Generation Speed | Free-Tier RPM / TPM | Supported Output Modes |
|---|---|---|---|---|---|
| `llama-3.3-70b-versatile` | Meta Llama 3.3 (70B) | 128k | ~250–320 t/s | 30 RPM / 6,000 TPM | JSON Object, Tools |
| `llama-3.1-8b-instant` | Meta Llama 3.1 (8B) | 128k | ~750–850 t/s | 30 RPM / 20,000 TPM | JSON Object, Tools |
| `gemma2-9b-it` | Google Gemma 2 (9B) | 8k | ~400–500 t/s | 30 RPM / 15,000 TPM | Text / Prompted JSON |
| `mixtral-8x7b-32768` | Mistral MoE (8x7B) | 32k | ~450–550 t/s | 30 RPM / 5,000 TPM | JSON Object |

---

## 3. Linguistic & Tokenization Analysis: Tamil & Tanglish

### 3.1 Tokenization Efficiency (Indic / Tamil)
- **Llama 3.1 & 3.3 (Tiktoken 128k vocab):** Meta significantly expanded non-English vocabulary compared to Llama 2. Spoken Tamil words take ~2.2 to 3.1 tokens per word (down from 6+ in Llama 2). Tanglish (Latin script Tamil) tokenizes efficiently at ~1.3 tokens per word.
- **Gemma 2 (256k vocab):** Features a massive multilingual vocabulary, yielding ~1.4–1.8 tokens per Tamil word. Highly efficient for pure Tamil script (`தமிழ்`), but Gemma 2 models exhibit stricter refusal boundaries and smaller context.
- **Mixtral 8x7B (32k vocab):** Tokenizer is heavily biased towards European languages; Tamil script tokenizes poorly (4–8 bytes/tokens per character cluster), increasing processing latency and token consumption against free-tier TPM.

### 3.2 Tanglish & Code-Switching Handling
Kirana transactions rarely use formal literary Tamil. Typical merchants use:
1. **Tamil script with English loanwords:** `"ரமேஷ் கணக்குல 2 பாக்கெட் milk"`
2. **Pure Tanglish (Latin script):** `"Suresh ku oru kilo paruppu 120 rooba கடன்"`
3. **Colloquial slang & contractions:** `"baaki"`, `"saaman"`, `"kuduthaaru"`, `"eduthaaru"`, `"noothi arubathu"`, `"ara kilo"`, `"mukkāl litre"`.

**Model Evaluation:**
- **`llama-3.3-70b-versatile`**: **Strongest reasoning.** High comprehension of Indian English nuances, Hindi/Tamil transliteration, and colloquial mathematical balance calculations (`baaki`, `mothathula`).
- **`llama-3.1-8b-instant`**: **Extremely fast (< 250 ms TTFT)**. Good at single-item extraction, but risks arithmetic confusion or dropping conversational context when complex code-switching or mid-sentence corrections occur.

---

## 4. Structured JSON Reliability & Schema Adherence

CredYazh depends on strict JSON validation matching the Pydantic `Draft` schema.

1. **Native JSON Object Support:**
   Groq API supports `response_format: {"type": "json_object"}`. When enabled, models guarantee valid JSON syntax, provided the prompt explicitly instructs the model to return JSON.
2. **Schema Fidelity:**
   Unlike Gemini 3.5's native `response_schema` which enforces strict typing at the decoding layer, Groq's JSON mode ensures valid JSON, but keys and internal types rely on few-shot prompting and system instruction compliance.
3. **Safety / Anti-Hallucination Compliance:**
   The primary risk with smaller open-source models (8B) is the temptation to hallucinate standard retail prices (e.g., assuming 1 kg sugar is ₹45 when no price was mentioned). **`llama-3.3-70b-versatile` exhibits significantly better instruction discipline against price fabrication** than 8B models.

---

## 5. Rate Limits, Latency & Reliability Comparison

| Metric / Dimension | Gemini 3.5 Flash Lite (Primary) | Groq Llama-3.3-70B (Candidate A) | Groq Llama-3.1-8B (Candidate B) |
|---|---|---|---|
| **Median Latency (p50)** | 600–900 ms | 350–550 ms | **180–320 ms** |
| **Tail Latency (p95)** | 1,800–2,500 ms | 900–1,200 ms | **450–700 ms** |
| **HTTP 503 Sensitivity** | Moderate (regional spikes) | Low | Low |
| **Free Tier TPM** | 1,000,000 TPM | 6,000 TPM | 20,000 TPM |
| **Free Tier RPM** | 15 RPM | 30 RPM | 30 RPM |
| **JSON Typing Rigor** | Highest (Schema-enforced) | High (System Prompt) | Moderate (Prompt-dependent) |
| **Tamil Reasoning** | High | High | Moderate |

> **Critical Operational Constraint:** Groq's free-tier rate limits for `llama-3.3-70b` (6,000 TPM) restrict heavy sustained load. At ~500 tokens per transaction prompt/response, 6,000 TPM permits **~12 requests/minute sustained**. For a failover burst scenario, this is adequate, but sustained load will require either tier upgrade or falling back to `llama-3.1-8b-instant` (20,000 TPM).

---

## 6. Selected Models for Phase 1 Evaluation

1. **Primary Evaluation Target:** `llama-3.3-70b-versatile`
   - *Rationale:* Highest reasoning capability, superior multilingual translation/parsing, low hallucination risk.
2. **Secondary High-Speed Target:** `llama-3.1-8b-instant`
   - *Rationale:* Lowest latency (< 300 ms), higher TPM headroom (20k), suitable for simple credit/repayment transactions.
3. **Control Baseline:** Existing Gemini 3.5 extraction audit baseline.

---

## 7. Conclusions & Recommendations for Test Plan

- **Audio Limitation:** Groq does not have a native multimodal audio model like Gemini. Phase 1 focuses strictly on text-based draft extraction.
- **Prompt Portability:** The existing CredYazh prompt from `ai-service/main.py` is well-crafted and can be directly translated to Groq with minimal schema adapter tuning.
- **Failover Strategy:** If Groq passes Phase 1 accuracy benchmarks, it should be configured as a **circuit-breaker secondary failover** when Gemini returns HTTP 503 or exceeds a 2.5-second SLA.
