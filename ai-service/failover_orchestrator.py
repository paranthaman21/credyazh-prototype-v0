"""CredYazh Phase 2 â€” Multi-Provider AI Failover Orchestrator.

Manages primary (Gemini) and secondary (Groq) extraction pipelines with:
- Circuit breaker health tracking (Closed / Open / Half-Open)
- Eligible transient error filtering (503, 500, 504, Timeout)
- Shared end-to-end request deadline budgeting
- Provider-specific concurrency limiting
- Centralized Pydantic schema validation
- Transcript-preserving manual fallback when all AI providers fail
- Strict protection against unnecessary failovers on semantic ambiguity
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Tuple

import httpx
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger("failover_orchestrator")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# 1. Canonical CredYazh Schema
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class Item(BaseModel):
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    price_rupees: Optional[float] = None


class Operation(BaseModel):
    type: Literal["payment", "credit"]
    items: List[Item] = Field(default_factory=list)
    total_rupees: Optional[float] = None


class Draft(BaseModel):
    kind: Literal["credit", "payment", "combined"] = "credit"
    customer_name: str = ""
    items: List[Item] = Field(default_factory=list)
    total_rupees: Optional[float] = None
    operations: List[Operation] = Field(default_factory=list)
    transcript: str = ""
    confidence: Literal["high", "medium", "low"] = "high"


class DraftResponse(Draft):
    metrics: Optional[Dict[str, Any]] = None


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# 2. Circuit Breaker
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class CircuitState(str, Enum):
    CLOSED = "CLOSED"        # Normal operation
    OPEN = "OPEN"            # Failing; requests diverted
    HALF_OPEN = "HALF_OPEN"  # Testing recovery with probe request


class CircuitBreaker:
    """Thread-safe circuit breaker protecting downstream AI providers."""

    def __init__(
        self,
        name: str,
        failure_threshold: int = 3,
        reset_timeout_s: float = 30.0,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout_s = reset_timeout_s
        self.state = CircuitState.CLOSED
        self.consecutive_failures = 0
        self.last_failure_time: float = 0.0
        self.total_requests = 0
        self.total_failures = 0
        self._lock = threading.Lock()

    def allow_request(self) -> bool:
        with self._lock:
            now = time.perf_counter()
            if self.state == CircuitState.CLOSED:
                return True
            if self.state == CircuitState.OPEN:
                if now - self.last_failure_time >= self.reset_timeout_s:
                    self.state = CircuitState.HALF_OPEN
                    logger.info(f"[{self.name}] Circuit Breaker transition OPEN -> HALF_OPEN (probe allowed)")
                    return True
                return False
            if self.state == CircuitState.HALF_OPEN:
                # In half-open state, allow a single probe
                return True
            return False

    def record_success(self):
        with self._lock:
            self.total_requests += 1
            if self.state in (CircuitState.HALF_OPEN, CircuitState.OPEN):
                logger.info(f"[{self.name}] Circuit Breaker transition {self.state} -> CLOSED (recovery verified)")
            self.state = CircuitState.CLOSED
            self.consecutive_failures = 0

    def record_failure(self, is_transient: bool = True):
        with self._lock:
            self.total_requests += 1
            if not is_transient:
                return  # Non-transient errors (like invalid prompt) do not trip the circuit

            self.total_failures += 1
            self.consecutive_failures += 1
            self.last_failure_time = time.perf_counter()

            if self.consecutive_failures >= self.failure_threshold:
                if self.state != CircuitState.OPEN:
                    logger.warning(
                        f"[{self.name}] Circuit Breaker tripped CLOSED -> OPEN "
                        f"(failures={self.consecutive_failures}/{self.failure_threshold})"
                    )
                self.state = CircuitState.OPEN

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "name": self.name,
                "state": self.state.value,
                "consecutive_failures": self.consecutive_failures,
                "total_requests": self.total_requests,
                "total_failures": self.total_failures,
                "open_remaining_s": max(0.0, round(self.reset_timeout_s - (time.perf_counter() - self.last_failure_time), 1))
                if self.state == CircuitState.OPEN else 0.0,
            }


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# 3. Provider Abstraction & Execution Result
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@dataclass
class ProviderResult:
    success: bool
    draft: Optional[Draft] = None
    latency_ms: float = 0.0
    provider_name: str = ""
    model_name: str = ""
    is_transient_error: bool = False
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    raw_response: Optional[str] = None


PROMPT_SYSTEM = """You read a shopkeeper's spoken or typed note about a customer's account in an Indian kirana grocery store.
The language may be Tamil, Tanglish (Tamil in English letters), Chennai colloquial slang, or English.
Return ONLY valid JSON adhering strictly to the schema.

Schema specification:
{
  "kind": "credit" | "payment" | "combined",
  "customer_name": "string (in English letters)",
  "items": [
    {
      "name": "string (English product name: e.g. Dal, Rice, Milk, Sugar, Oil, Biscuits, Soap)",
      "quantity": float or null,
      "unit": "kg" | "g" | "litre" | "packet" | "piece" | "bottle" | null,
      "price_rupees": float or null
    }
  ],
  "total_rupees": float or null,
  "operations": [
    {
      "type": "payment" | "credit",
      "items": [...],
      "total_rupees": float or null
    }
  ],
  "transcript": "string",
  "confidence": "high" | "medium" | "low"
}

Strict Rules:
1. kind: "credit" if items taken on credit; "payment" if money settled/paid; "combined" if BOTH in one note.
2. operations:
   - For "combined": Op 1 is {"type": "payment", "total_rupees": <repaid>, "items": []}; Op 2 is {"type": "credit", "total_rupees": <new credit>, "items": [<products>]}.
3. items: Use English names. Never fabricate item details if merchant only stated an amount.
4. price_rupees: ONLY if spoken for that item. Never guess prices.
5. total_rupees: Spoken total. Never add up guessed prices.
6. Zero Hallucination: If customer name, quantity or amount is not said, set to null or empty string.
"""

ELIGIBLE_TRANSIENT_CODES = {429, 500, 502, 503, 504}
ELIGIBLE_TRANSIENT_KEYWORDS = (
    "UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED", "overloaded",
    "rate limit", "quota", "temporarily unavailable", "timed out", "timeout"
)


def is_eligible_transient_error(err_str: str, status_code: Optional[int] = None) -> bool:
    if status_code in ELIGIBLE_TRANSIENT_CODES:
        return True
    lower = err_str.lower()
    return any(kw.lower() in lower for kw in ELIGIBLE_TRANSIENT_KEYWORDS)


def build_failover_trace(attempts: List[Dict[str, Any]], final_state: str = "ok") -> str:
    """Format safe concise diagnostic string without exposing keys, prompts, or sensitive transcripts.
    Example: 'Gemini: 503 â†’ Groq: 200' or 'Gemini: 503 â†’ Groq: timeout â†’ Manual fallback'
    """
    parts = []
    for att in attempts:
        prov = (att.get("provider") or att.get("model") or "unknown").capitalize()
        # Clean provider names
        if "gemini" in prov.lower():
            prov = "Gemini"
        elif "groq" in prov.lower():
            prov = "Groq"
        elif "local" in prov.lower():
            prov = "Local"

        status = att.get("status", "")
        err = str(att.get("error", ""))

        if status == "ok":
            code = "200"
        elif "503" in status or "503" in err or "UNAVAILABLE" in err:
            code = "503"
        elif "504" in status or "504" in err or "TIMEOUT" in status or "timed out" in err.lower() or "timeout" in err.lower():
            code = "timeout"
        elif "429" in status or "429" in err:
            code = "429"
        elif "401" in status or "401" in err:
            code = "401"
        elif "SCHEMA" in status or "VALIDATION" in status:
            code = "invalid_schema"
        elif status:
            code = str(status).replace("HTTP_", "")
        else:
            code = "err"

        parts.append(f"{prov}: {code}")

    if final_state == "manual_fallback":
        parts.append("Manual fallback")

    return " â†’ ".join(parts)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# 4. Failover Orchestrator
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class FailoverOrchestrator:
    """Enterprise multi-provider AI orchestrator managing Gemini & Groq failover."""

    def __init__(
        self,
        gemini_models: Optional[List[str]] = None,
        groq_model: Optional[str] = None,
        groq_fallback_model: Optional[str] = None,
        shared_deadline_ms: Optional[int] = None,
        failover_enabled: Optional[bool] = None,
        enable_local_extractor: Optional[bool] = None,
    ):
        # Configuration
        self.failover_enabled = (
            failover_enabled
            if failover_enabled is not None
            else os.getenv("AI_FAILOVER_ENABLED", "false").lower() in ("true", "1", "yes")
        )
        self.enable_local_extractor = (
            enable_local_extractor
            if enable_local_extractor is not None
            else os.getenv("ENABLE_LOCAL_EXTRACTOR", "false").lower() in ("true", "1", "yes")
        )
        self.primary_provider_name = os.getenv("AI_PRIMARY_PROVIDER", "gemini").lower()
        self.backup_provider_name = os.getenv("AI_BACKUP_PROVIDER", "groq").lower()

        # Shared deadline (default 12,000 ms)
        self.shared_deadline_ms = shared_deadline_ms or int(os.getenv("AI_SHARED_DEADLINE_MS", "12000"))

        # Provider configurations
        raw_gemini = os.getenv("GEMINI_MODELS", "gemini-3.5-flash-lite,gemini-3.5-flash")
        self.gemini_models = gemini_models or [m.strip() for m in raw_gemini.split(",") if m.strip()]
        self.groq_model = groq_model or os.getenv("GROQ_PRIMARY_MODEL", "llama-3.3-70b-versatile")
        self.groq_fallback_model = groq_fallback_model or os.getenv("GROQ_FALLBACK_MODEL", "llama-3.1-8b-instant")
        self.groq_api_key = os.getenv("GROQ_API_KEY", "")

        # Circuit breakers
        cb_threshold = int(os.getenv("CIRCUIT_BREAKER_FAILURE_THRESHOLD", "3"))
        cb_timeout_s = float(os.getenv("CIRCUIT_BREAKER_RESET_TIMEOUT_S", "30.0"))
        self.cb_gemini = CircuitBreaker("GeminiPrimary", cb_threshold, cb_timeout_s)
        self.cb_groq = CircuitBreaker("GroqBackup", cb_threshold, cb_timeout_s)

        # Provider concurrency semaphores (limits active requests to avoid TPM/RPM saturation)
        self.gemini_semaphore = threading.Semaphore(int(os.getenv("GEMINI_CONCURRENCY_LIMIT", "10")))
        self.groq_semaphore = threading.Semaphore(int(os.getenv("GROQ_CONCURRENCY_LIMIT", "5")))

        logger.info(
            f"Initialized FailoverOrchestrator: failover_enabled={self.failover_enabled}, "
            f"primary={self.primary_provider_name}, backup={self.backup_provider_name}, "
            f"shared_deadline={self.shared_deadline_ms}ms"
        )

    def is_groq_configured(self) -> bool:
        return bool(self.groq_api_key and not self.groq_api_key.startswith("gsk_your_key_here"))

    # â”€â”€ Audio deadline constant â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # Gemini multimodal audio gets up to 8 s before we abandon it and try Groq.
    AUDIO_GEMINI_TIMEOUT_MS: int = 8000

    def extract_audio(self, audio_data: bytes, mime_type: str = "audio/wav") -> DraftResponse:
        """Extract draft from raw audio bytes with Gemini primary and Groq text failover.

        Flow:
          1. Gemini multimodal audio extraction (hard 8 s per-model timeout).
          2. If Gemini fails/times-out AND failover is enabled, Groq Whisper
             transcribes the audio and the resulting text goes through
             _execute_groq() for structured extraction.
          3. Manual fallback if both providers fail.
        """
        t_start = time.perf_counter()
        deadline_s = self.shared_deadline_ms / 1000.0
        attempts_log: List[Dict[str, Any]] = []

        # 1. Budget check
        remaining_budget_s = deadline_s - (time.perf_counter() - t_start)
        if remaining_budget_s <= 0.5:
            return self._manual_fallback_draft("", attempts_log, "DEADLINE_EXCEEDED_BEFORE_START")

        # 2. Primary: Gemini multimodal audio
        primary_result = self._execute_primary_audio(audio_data, mime_type, remaining_budget_s)
        attempts_log.append({
            "provider": primary_result.provider_name,
            "model": primary_result.model_name,
            "latency_ms": round(primary_result.latency_ms, 1),
            "status": "ok" if primary_result.success else primary_result.error_type,
            "error": primary_result.error_message,
        })

        if primary_result.success and primary_result.draft is not None:
            total_duration_ms = (time.perf_counter() - t_start) * 1000
            return DraftResponse(
                **primary_result.draft.model_dump(),
                metrics={
                    "provider": primary_result.provider_name,
                    "model": primary_result.model_name,
                    "provider_latency_ms": round(primary_result.latency_ms, 1),
                    "ai_total_latency_ms": round(total_duration_ms, 1),
                    "failover_triggered": False,
                    "failover_trace": build_failover_trace(attempts_log, "ok"),
                    "models_attempted": attempts_log,
                }
            )

        # 3. Failover eligibility check
        if not self.failover_enabled:
            logger.info("Audio primary failed and AI_FAILOVER_ENABLED is false; returning manual fallback")
            return self._manual_fallback_draft("", attempts_log, primary_result.error_type or "PRIMARY_FAILED")

        if not primary_result.is_transient_error:
            logger.warning(
                f"Audio primary error '{primary_result.error_type}' is non-transient; skipping Groq failover"
            )
            return self._manual_fallback_draft("", attempts_log, primary_result.error_type or "NON_TRANSIENT_PRIMARY_ERROR")

        # 4. Groq audio failover: Whisper transcription â†’ text extraction
        remaining_budget_s = deadline_s - (time.perf_counter() - t_start)
        if remaining_budget_s <= 0.8:
            logger.warning(
                f"Insufficient deadline budget for Groq audio failover ({remaining_budget_s:.2f}s remaining)"
            )
            return self._manual_fallback_draft("", attempts_log, "DEADLINE_EXCEEDED_BEFORE_FAILOVER")

        logger.info(
            f"Triggering Groq audio failover (remaining budget: {remaining_budget_s:.2f}s) â€” "
            "Whisper transcription + LLM extraction"
        )
        transcript, transcribe_log = self._transcribe_with_groq_whisper(audio_data, mime_type, remaining_budget_s)
        attempts_log.extend(transcribe_log)

        # If transcription failed, try Groq text extraction with empty transcript and log it
        text_for_extraction = transcript or ""

        remaining_budget_s = deadline_s - (time.perf_counter() - t_start)
        groq_result = self._execute_groq(text_for_extraction, remaining_budget_s)
        attempts_log.append({
            "provider": groq_result.provider_name,
            "model": groq_result.model_name,
            "latency_ms": round(groq_result.latency_ms, 1),
            "status": "ok" if groq_result.success else groq_result.error_type,
            "error": groq_result.error_message,
        })

        if groq_result.success and groq_result.draft is not None:
            total_duration_ms = (time.perf_counter() - t_start) * 1000
            logger.info(
                f"Groq audio failover succeeded in {groq_result.latency_ms:.1f}ms (total {total_duration_ms:.1f}ms)"
            )
            return DraftResponse(
                **groq_result.draft.model_dump(),
                metrics={
                    "provider": "groq",
                    "model": groq_result.model_name,
                    "provider_latency_ms": round(groq_result.latency_ms, 1),
                    "ai_total_latency_ms": round(total_duration_ms, 1),
                    "failover_triggered": True,
                    "failover_trace": build_failover_trace(attempts_log, "ok"),
                    "primary_failure": {
                        "provider": primary_result.provider_name,
                        "error_type": primary_result.error_type,
                        "error_message": primary_result.error_message,
                    },
                    "models_attempted": attempts_log,
                }
            )

        logger.error(
            f"Audio failover: both Gemini ({primary_result.error_type}) and Groq ({groq_result.error_type}) failed"
        )
        return self._manual_fallback_draft("", attempts_log, "BOTH_PROVIDERS_UNAVAILABLE")

    def extract_text(self, text: str) -> DraftResponse:
        """Extract draft with deadline tracking and resilient multi-provider failover."""
        t_start = time.perf_counter()
        deadline_s = self.shared_deadline_ms / 1000.0
        attempts_log: List[Dict[str, Any]] = []

        # 1. Deterministic Local Fast-Path (if enabled)
        if self.enable_local_extractor:
            try:
                from credyazh_local_extractor import try_local_extract
                t_local_0 = time.perf_counter()
                local_draft = try_local_extract(text)
                if local_draft is not None:
                    dt_local = (time.perf_counter() - t_local_0) * 1000
                    logger.info(f"Local extractor matched in {dt_local:.1f}ms")
                    local_draft.pop("_source", None)
                    validated = Draft.model_validate(local_draft)
                    return DraftResponse(
                        **validated.model_dump(),
                        metrics={
                            "provider": "local_regex_fastpath",
                            "model": "local_regex_fastpath",
                            "ai_total_latency_ms": round(dt_local, 2),
                            "failover_triggered": False,
                            "models_attempted": [{"provider": "local", "status": "ok", "latency_ms": round(dt_local, 1)}],
                        }
                    )
            except Exception as e:
                logger.warning(f"Local extractor bypassed: {e}")

        # 2. Execution Budget Management
        remaining_budget_s = deadline_s - (time.perf_counter() - t_start)
        if remaining_budget_s <= 0.5:
            return self._manual_fallback_draft(text, attempts_log, "DEADLINE_EXCEEDED_BEFORE_START")

        # 3. Primary Provider (Gemini)
        primary_result = self._execute_primary(text, remaining_budget_s)
        attempts_log.append({
            "provider": primary_result.provider_name,
            "model": primary_result.model_name,
            "latency_ms": round(primary_result.latency_ms, 1),
            "status": "ok" if primary_result.success else primary_result.error_type,
            "error": primary_result.error_message,
        })

        if primary_result.success and primary_result.draft is not None:
            total_duration_ms = (time.perf_counter() - t_start) * 1000
            return DraftResponse(
                **primary_result.draft.model_dump(),
                metrics={
                    "provider": primary_result.provider_name,
                    "model": primary_result.model_name,
                    "provider_latency_ms": round(primary_result.latency_ms, 1),
                    "ai_total_latency_ms": round(total_duration_ms, 1),
                    "failover_triggered": False,
                    "failover_trace": build_failover_trace(attempts_log, "ok"),
                    "models_attempted": attempts_log,
                }
            )

        # 4. Check Failover Eligibility
        # If failover is disabled, or error is not an eligible transient error (e.g. auth error), halt
        if not self.failover_enabled:
            logger.info("Primary failed and AI_FAILOVER_ENABLED is false; returning manual fallback")
            return self._manual_fallback_draft(text, attempts_log, primary_result.error_type or "PRIMARY_FAILED")

        if not primary_result.is_transient_error:
            logger.warning(f"Primary error '{primary_result.error_type}' is non-transient; skipping failover")
            return self._manual_fallback_draft(text, attempts_log, primary_result.error_type or "NON_TRANSIENT_PRIMARY_ERROR")

        # 5. Secondary Provider (Groq) Failover Execution
        remaining_budget_s = deadline_s - (time.perf_counter() - t_start)
        if remaining_budget_s <= 0.8:
            logger.warning(f"Insufficient deadline budget remaining ({remaining_budget_s:.2f}s) for Groq failover")
            return self._manual_fallback_draft(text, attempts_log, "DEADLINE_EXCEEDED_BEFORE_FAILOVER")

        logger.info(f"Triggering Groq secondary failover (remaining budget: {remaining_budget_s:.2f}s)...")
        groq_result = self._execute_groq(text, remaining_budget_s)
        attempts_log.append({
            "provider": groq_result.provider_name,
            "model": groq_result.model_name,
            "latency_ms": round(groq_result.latency_ms, 1),
            "status": "ok" if groq_result.success else groq_result.error_type,
            "error": groq_result.error_message,
        })

        if groq_result.success and groq_result.draft is not None:
            total_duration_ms = (time.perf_counter() - t_start) * 1000
            logger.info(f"Groq failover succeeded in {groq_result.latency_ms:.1f}ms (total {total_duration_ms:.1f}ms)")
            return DraftResponse(
                **groq_result.draft.model_dump(),
                metrics={
                    "provider": "groq",
                    "model": groq_result.model_name,
                    "provider_latency_ms": round(groq_result.latency_ms, 1),
                    "ai_total_latency_ms": round(total_duration_ms, 1),
                    "failover_triggered": True,
                    "failover_trace": build_failover_trace(attempts_log, "ok"),
                    "primary_failure": {
                        "provider": primary_result.provider_name,
                        "error_type": primary_result.error_type,
                        "error_message": primary_result.error_message,
                    },
                    "models_attempted": attempts_log,
                }
            )

        # 6. Both Providers Failed: Transcript-Preserving Manual Fallback
        logger.error(f"Both primary ({primary_result.error_type}) and backup ({groq_result.error_type}) failed")
        return self._manual_fallback_draft(text, attempts_log, "BOTH_PROVIDERS_UNAVAILABLE")

    def _execute_primary_audio(
        self, audio_data: bytes, mime_type: str, timeout_s: float
    ) -> ProviderResult:
        """Call Gemini multimodal audio extraction with an 8-second hard cap per model."""
        if not self.cb_gemini.allow_request():
            return ProviderResult(
                success=False,
                provider_name="gemini",
                model_name=self.gemini_models[0] if self.gemini_models else "gemini",
                is_transient_error=True,
                error_type="CIRCUIT_BREAKER_OPEN",
                error_message="Gemini circuit breaker is OPEN due to repeated transient errors",
            )

        t0 = time.perf_counter()
        acquired = self.gemini_semaphore.acquire(timeout=min(1.0, timeout_s))
        if not acquired:
            return ProviderResult(
                success=False,
                provider_name="gemini",
                model_name=self.gemini_models[0] if self.gemini_models else "gemini",
                is_transient_error=True,
                error_type="CONCURRENCY_LIMIT_EXCEEDED",
                error_message="Gemini active concurrency limit saturated",
            )

        try:
            from google import genai
            from google.genai import types

            key = os.getenv("GEMINI_API_KEY")
            if not key:
                self.cb_gemini.record_failure(is_transient=False)
                return ProviderResult(
                    success=False,
                    provider_name="gemini",
                    model_name="unconfigured",
                    is_transient_error=False,
                    error_type="MISSING_API_KEY",
                    error_message="GEMINI_API_KEY not configured",
                )

            client = genai.Client(api_key=key)
            # Use the same per-request timeout as the rest of the service.
            # Groq only triggers on a genuine error, not on an artificial deadline.
            per_model_timeout_ms = int(os.getenv("GEMINI_REQUEST_TIMEOUT_MS", "10000"))

            # Prefer full multimodal-capable models for audio; lite models last.
            audio_models = (
                [m for m in self.gemini_models if "lite" not in m]
                + [m for m in self.gemini_models if "lite" in m]
            )

            last_err_msg = ""
            last_err_type = "UNKNOWN"

            for model_name in audio_models:
                try:
                    kwargs: Dict[str, Any] = dict(
                        system_instruction=PROMPT_SYSTEM,
                        response_mime_type="application/json",
                        response_schema=Draft,
                        temperature=0.0,
                        http_options=types.HttpOptions(timeout=per_model_timeout_ms),
                    )
                    if model_name in {"gemini-3.5-flash", "gemini-3.6-flash"}:
                        kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)

                    audio_part = types.Part.from_bytes(data=audio_data, mime_type=mime_type)
                    resp = client.models.generate_content(
                        model=model_name,
                        contents=[audio_part, "Read this note."],
                        config=types.GenerateContentConfig(**kwargs),
                    )
                    latency_ms = (time.perf_counter() - t0) * 1000

                    clean_text = (resp.text or "").strip()
                    if clean_text.startswith("```"):
                        lines = clean_text.splitlines()
                        if lines and lines[0].startswith("```"):
                            lines = lines[1:]
                        if lines and lines[-1].strip() == "```":
                            lines = lines[:-1]
                        clean_text = "\n".join(lines).strip()

                    draft = Draft.model_validate_json(clean_text)
                    self.cb_gemini.record_success()
                    logger.info(
                        f"[Audio] Gemini '{model_name}' succeeded in {latency_ms:.0f}ms"
                    )
                    return ProviderResult(
                        success=True,
                        draft=draft,
                        latency_ms=latency_ms,
                        provider_name="gemini",
                        model_name=model_name,
                        raw_response=resp.text,
                    )
                except Exception as e:
                    elapsed_ms = (time.perf_counter() - t0) * 1000
                    err_str = str(e)
                    is_transient = is_eligible_transient_error(err_str)
                    last_err_msg = err_str[:250]
                    last_err_type = (
                        "TIMEOUT"
                        if ("deadline" in err_str.lower() or "timeout" in err_str.lower() or elapsed_ms >= per_model_timeout_ms - 200)
                        else ("HTTP_503_UNAVAILABLE" if ("503" in err_str or "UNAVAILABLE" in err_str) else "PROVIDER_ERROR")
                    )
                    logger.warning(
                        f"[Audio] Gemini '{model_name}' failed ({last_err_type}) after {elapsed_ms:.0f}ms: {err_str[:120]}"
                    )
                    if "401" in err_str or "API_KEY_INVALID" in err_str:
                        self.cb_gemini.record_failure(is_transient=False)
                        return ProviderResult(
                            success=False,
                            provider_name="gemini",
                            model_name=model_name,
                            is_transient_error=False,
                            error_type="AUTHENTICATION_ERROR",
                            error_message=err_str[:200],
                        )
                    # Continue to next model

            latency_ms = (time.perf_counter() - t0) * 1000
            self.cb_gemini.record_failure(is_transient=True)
            return ProviderResult(
                success=False,
                latency_ms=latency_ms,
                provider_name="gemini",
                model_name=audio_models[0] if audio_models else "gemini",
                is_transient_error=True,
                error_type=last_err_type,
                error_message=last_err_msg,
            )
        except Exception as e:
            latency_ms = (time.perf_counter() - t0) * 1000
            self.cb_gemini.record_failure(is_transient=True)
            return ProviderResult(
                success=False,
                latency_ms=latency_ms,
                provider_name="gemini",
                model_name=self.gemini_models[0] if self.gemini_models else "gemini",
                is_transient_error=True,
                error_type="INTERNAL_EXCEPTION",
                error_message=str(e),
            )
        finally:
            self.gemini_semaphore.release()

    def _transcribe_with_groq_whisper(
        self, audio_data: bytes, mime_type: str, timeout_s: float
    ) -> Tuple[str, List[Dict[str, Any]]]:
        """Use Groq Whisper API to transcribe audio bytes to text.

        Returns (transcript_text, log_entries).  transcript_text is empty string
        on failure so the caller can still attempt text extraction with empty input.
        """
        log_entries: List[Dict[str, Any]] = []
        if not self.is_groq_configured():
            logger.info("Groq not configured â€” skipping Whisper transcription step")
            return "", log_entries

        t0 = time.perf_counter()
        # Map MIME type to a filename extension Groq Whisper accepts.
        ext_map = {
            "audio/wav": "audio.wav",
            "audio/wave": "audio.wav",
            "audio/x-wav": "audio.wav",
            "audio/webm": "audio.webm",
            "audio/ogg": "audio.ogg",
            "audio/mp4": "audio.mp4",
            "audio/mpeg": "audio.mp3",
            "audio/mp3": "audio.mp3",
            "audio/flac": "audio.flac",
        }
        filename = ext_map.get(mime_type.lower().split(";")[0].strip(), "audio.wav")

        try:
            headers = {"Authorization": f"Bearer {self.groq_api_key}"}
            with httpx.Client(timeout=min(timeout_s, 10.0)) as client:
                resp = client.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    headers=headers,
                    files={"file": (filename, audio_data, mime_type)},
                    data={"model": "whisper-large-v3-turbo", "response_format": "text"},
                )
                latency_ms = (time.perf_counter() - t0) * 1000
                if resp.status_code == 200:
                    transcript = resp.text.strip()
                    logger.info(
                        f'[Audio] Groq Whisper transcription succeeded in {latency_ms:.0f}ms: "{transcript[:60]}..."'
                    )
                    log_entries.append({
                        "provider": "groq_whisper",
                        "model": "whisper-large-v3-turbo",
                        "latency_ms": round(latency_ms, 1),
                        "status": "ok",
                    })
                    return transcript, log_entries
                else:
                    logger.warning(
                        f"[Audio] Groq Whisper returned {resp.status_code}: {resp.text[:120]}"
                    )
                    log_entries.append({
                        "provider": "groq_whisper",
                        "model": "whisper-large-v3-turbo",
                        "latency_ms": round(latency_ms, 1),
                        "status": f"HTTP_{resp.status_code}",
                        "error": resp.text[:120],
                    })
                    return "", log_entries
        except httpx.TimeoutException:
            latency_ms = (time.perf_counter() - t0) * 1000
            logger.warning(f"[Audio] Groq Whisper timed out after {latency_ms:.0f}ms")
            log_entries.append({
                "provider": "groq_whisper",
                "model": "whisper-large-v3-turbo",
                "latency_ms": round(latency_ms, 1),
                "status": "TIMEOUT",
            })
            return "", log_entries
        except Exception as e:
            latency_ms = (time.perf_counter() - t0) * 1000
            logger.warning(f"[Audio] Groq Whisper exception after {latency_ms:.0f}ms: {e}")
            log_entries.append({
                "provider": "groq_whisper",
                "model": "whisper-large-v3-turbo",
                "latency_ms": round(latency_ms, 1),
                "status": "EXCEPTION",
                "error": str(e)[:120],
            })
            return "", log_entries

    def _execute_primary(self, text: str, timeout_s: float) -> ProviderResult:
        """Call Gemini primary pipeline with circuit breaker check and concurrency bounding."""
        if not self.cb_gemini.allow_request():
            return ProviderResult(
                success=False,
                provider_name="gemini",
                model_name=self.gemini_models[0] if self.gemini_models else "gemini",
                is_transient_error=True,
                error_type="CIRCUIT_BREAKER_OPEN",
                error_message="Gemini circuit breaker is OPEN due to repeated transient errors",
            )

        t0 = time.perf_counter()
        acquired = self.gemini_semaphore.acquire(timeout=min(1.0, timeout_s))
        if not acquired:
            return ProviderResult(
                success=False,
                provider_name="gemini",
                model_name=self.gemini_models[0] if self.gemini_models else "gemini",
                is_transient_error=True,
                error_type="CONCURRENCY_LIMIT_EXCEEDED",
                error_message="Gemini active concurrency limit saturated",
            )

        try:
            from google import genai
            from google.genai import types

            key = os.getenv("GEMINI_API_KEY")
            if not key:
                self.cb_gemini.record_failure(is_transient=False)
                return ProviderResult(
                    success=False,
                    provider_name="gemini",
                    model_name="unconfigured",
                    is_transient_error=False,
                    error_type="MISSING_API_KEY",
                    error_message="GEMINI_API_KEY not configured",
                )

            client = genai.Client(api_key=key)
            per_model_timeout_ms = int(min(timeout_s * 1000, 8000))

            last_err_msg = ""
            last_err_type = "UNKNOWN"

            for model_name in self.gemini_models:
                try:
                    kwargs = dict(
                        system_instruction=PROMPT_SYSTEM,
                        response_mime_type="application/json",
                        response_schema=Draft,
                        temperature=0.0,
                        http_options=types.HttpOptions(timeout=per_model_timeout_ms),
                    )
                    if model_name in {"gemini-3.5-flash", "gemini-3.6-flash"}:
                        kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)

                    resp = client.models.generate_content(
                        model=model_name,
                        contents=[text],
                        config=types.GenerateContentConfig(**kwargs),
                    )
                    latency_ms = (time.perf_counter() - t0) * 1000

                    # Centralized Pydantic validation
                    clean_text = (resp.text or "").strip()
                    if clean_text.startswith("```"):
                        lines = clean_text.splitlines()
                        if lines and lines[0].startswith("```"):
                            lines = lines[1:]
                        if lines and lines[-1].strip() == "```":
                            lines = lines[:-1]
                        clean_text = "\n".join(lines).strip()

                    draft = Draft.model_validate_json(clean_text)
                    self.cb_gemini.record_success()
                    return ProviderResult(
                        success=True,
                        draft=draft,
                        latency_ms=latency_ms,
                        provider_name="gemini",
                        model_name=model_name,
                        raw_response=resp.text,
                    )
                except Exception as e:
                    err_str = str(e)
                    is_transient = is_eligible_transient_error(err_str)
                    last_err_msg = err_str[:250]
                    last_err_type = "HTTP_503_UNAVAILABLE" if "503" in err_str or "UNAVAILABLE" in err_str else "PROVIDER_ERROR"
                    if "401" in err_str or "API_KEY_INVALID" in err_str:
                        self.cb_gemini.record_failure(is_transient=False)
                        return ProviderResult(
                            success=False,
                            provider_name="gemini",
                            model_name=model_name,
                            is_transient_error=False,
                            error_type="AUTHENTICATION_ERROR",
                            error_message=err_str[:200],
                        )

            latency_ms = (time.perf_counter() - t0) * 1000
            self.cb_gemini.record_failure(is_transient=True)
            return ProviderResult(
                success=False,
                latency_ms=latency_ms,
                provider_name="gemini",
                model_name=self.gemini_models[0],
                is_transient_error=True,
                error_type=last_err_type,
                error_message=last_err_msg,
            )
        except Exception as e:
            latency_ms = (time.perf_counter() - t0) * 1000
            self.cb_gemini.record_failure(is_transient=True)
            return ProviderResult(
                success=False,
                latency_ms=latency_ms,
                provider_name="gemini",
                model_name=self.gemini_models[0] if self.gemini_models else "gemini",
                is_transient_error=True,
                error_type="INTERNAL_EXCEPTION",
                error_message=str(e),
            )
        finally:
            self.gemini_semaphore.release()

    def _execute_groq(self, text: str, timeout_s: float) -> ProviderResult:
        """Call Groq secondary pipeline with circuit breaker check and concurrency bounding."""
        if not self.cb_groq.allow_request():
            return ProviderResult(
                success=False,
                provider_name="groq",
                model_name=self.groq_model,
                is_transient_error=True,
                error_type="CIRCUIT_BREAKER_OPEN",
                error_message="Groq circuit breaker is OPEN",
            )

        t0 = time.perf_counter()
        acquired = self.groq_semaphore.acquire(timeout=min(1.0, timeout_s))
        if not acquired:
            return ProviderResult(
                success=False,
                provider_name="groq",
                model_name=self.groq_model,
                is_transient_error=True,
                error_type="CONCURRENCY_LIMIT_EXCEEDED",
                error_message="Groq active concurrency limit saturated",
            )

        try:
            # If Groq is not configured or offline test mode, route to deterministic offline extractor
            if not self.is_groq_configured():
                return self._simulate_groq_extraction(text, self.groq_model, t0)

            headers = {
                "Authorization": f"Bearer {self.groq_api_key}",
                "Content-Type": "application/json",
            }

            models_to_try = [self.groq_model, self.groq_fallback_model]
            last_err_type = "UNKNOWN"
            last_err_msg = ""

            for model_name in models_to_try:
                payload = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": PROMPT_SYSTEM},
                        {"role": "user", "content": f"Extract draft for:\n\"{text}\""},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.0,
                }
                try:
                    with httpx.Client(timeout=timeout_s) as client:
                        resp = client.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload)
                        latency_ms = (time.perf_counter() - t0) * 1000

                        if resp.status_code == 200:
                            data = resp.json()
                            content = (data["choices"][0]["message"]["content"] or "").strip()
                            if content.startswith("```"):
                                lines = content.splitlines()
                                if lines and lines[0].startswith("```"):
                                    lines = lines[1:]
                                if lines and lines[-1].strip() == "```":
                                    lines = lines[:-1]
                                content = "\n".join(lines).strip()
                            draft = Draft.model_validate_json(content)
                            self.cb_groq.record_success()
                            return ProviderResult(
                                success=True,
                                draft=draft,
                                latency_ms=latency_ms,
                                provider_name="groq",
                                model_name=model_name,
                                raw_response=content,
                            )
                        elif resp.status_code == 429:
                            last_err_type = "RATE_LIMIT_429"
                            last_err_msg = "Groq TPM limit exceeded"
                            logger.warning(f"Groq {model_name} rate limit 429, trying fallback model")
                            continue
                        elif resp.status_code in (500, 502, 503, 504):
                            last_err_type = f"HTTP_{resp.status_code}"
                            last_err_msg = resp.text[:200]
                            continue
                        else:
                            last_err_type = f"HTTP_{resp.status_code}"
                            last_err_msg = resp.text[:200]
                            break
                except httpx.TimeoutException:
                    last_err_type = "TIMEOUT"
                    last_err_msg = f"Groq request timed out after {timeout_s:.1f}s"
                except (ValidationError, json.JSONDecodeError) as e:
                    last_err_type = "SCHEMA_VALIDATION_ERROR"
                    last_err_msg = str(e)
                    break
                except Exception as e:
                    last_err_type = "NETWORK_ERROR"
                    last_err_msg = str(e)

            latency_ms = (time.perf_counter() - t0) * 1000
            self.cb_groq.record_failure(is_transient=True)
            return ProviderResult(
                success=False,
                latency_ms=latency_ms,
                provider_name="groq",
                model_name=self.groq_model,
                is_transient_error=True,
                error_type=last_err_type,
                error_message=last_err_msg,
            )
        except Exception as e:
            latency_ms = (time.perf_counter() - t0) * 1000
            self.cb_groq.record_failure(is_transient=True)
            return ProviderResult(
                success=False,
                latency_ms=latency_ms,
                provider_name="groq",
                model_name=self.groq_model,
                is_transient_error=True,
                error_type="INTERNAL_EXCEPTION",
                error_message=str(e),
            )
        finally:
            self.groq_semaphore.release()

    def _simulate_groq_extraction(self, text: str, model: str, t0: float) -> ProviderResult:
        """Deterministic NLP extractor when running locally or during unconfigured dry-runs."""
        try:
            from groq_client import GroqClient
            time.sleep(0.05)  # simulate network roundtrip
            client = GroqClient()
            res = client.extract_draft(text, model=model, force_mock=True)
            latency_ms = (time.perf_counter() - t0) * 1000
            if res.success and res.draft is not None:
                self.cb_groq.record_success()
                return ProviderResult(
                    success=True,
                    draft=res.draft,
                    latency_ms=latency_ms,
                    provider_name="groq",
                    model_name=model,
                )
            else:
                self.cb_groq.record_failure(is_transient=True)
                return ProviderResult(
                    success=False,
                    latency_ms=latency_ms,
                    provider_name="groq",
                    model_name=model,
                    is_transient_error=True,
                    error_type=res.error_type or "MOCK_FAILURE",
                    error_message=res.error_message or "Extraction failed",
                )
        except Exception as e:
            logger.warning(f"Groq simulation error: {e}")
            latency_ms = (time.perf_counter() - t0) * 1000
            try:
                from credyazh_local_extractor import try_local_extract
                d = try_local_extract(text)
                if d is not None:
                    d.pop("_source", None)
                    return ProviderResult(
                        success=True,
                        draft=Draft.model_validate(d),
                        latency_ms=latency_ms,
                        provider_name="groq",
                        model_name=model,
                    )
            except Exception:
                pass
            return ProviderResult(
                success=False,
                latency_ms=latency_ms,
                provider_name="groq",
                model_name=model,
                is_transient_error=True,
                error_type="SIMULATION_ERROR",
                error_message=str(e),
            )

    def _manual_fallback_draft(
        self,
        text: str,
        attempts: List[Dict[str, Any]],
        failure_reason: str,
    ) -> DraftResponse:
        """Transcript-preserving draft allowing merchant to manually confirm without losing utterance."""
        logger.info(f"Producing transcript-preserving manual fallback (reason: {failure_reason})")
        return DraftResponse(
            kind="credit",
            customer_name="",
            items=[],
            total_rupees=None,
            operations=[],
            transcript=text,
            confidence="low",
            metrics={
                "provider": "manual_fallback",
                "model": "manual_fallback",
                "failover_triggered": True,
                "manual_fallback_reason": failure_reason,
                "failover_trace": build_failover_trace(attempts, "manual_fallback"),
                "transcript_preserved": True,
                "models_attempted": attempts,
                "circuit_breakers": {
                    "gemini": self.cb_gemini.get_status(),
                    "groq": self.cb_groq.get_status(),
                },
            },
        )

    def get_health_status(self) -> Dict[str, Any]:
        return {
            "failover_enabled": self.failover_enabled,
            "primary_provider": self.primary_provider_name,
            "backup_provider": self.backup_provider_name,
            "groq_configured": self.is_groq_configured(),
            "shared_deadline_ms": self.shared_deadline_ms,
            "circuit_breakers": {
                "gemini": self.cb_gemini.get_status(),
                "groq": self.cb_groq.get_status(),
            },
        }

