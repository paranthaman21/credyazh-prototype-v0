"""CredYazh AI service.

It turns a spoken (or typed) sentence into a *draft* transaction. It does not know
about the database and never saves anything. The Express API validates the draft and
the merchant confirms it.
"""
import logging
import os
import time
import base64
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

load_dotenv()

logger = logging.getLogger("ai_service")
logging.basicConfig(level=logging.INFO)

# Default extraction chain: fast non-thinking models only.
# gemini-3.7-flash and gemini-3.8-flash are thinking models; they incur 30–60 s
# latency on structured JSON extraction and are NOT suitable as sync extraction fallbacks.
# Add them here only if you have confirmed they are fast enough for your use-case.
raw_models = os.getenv("GEMINI_MODELS", "gemini-3.5-flash-lite,gemini-3.5-flash")
MODELS = [m.strip() for m in raw_models.split(",") if m.strip()]
if not MODELS:
    MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash"]
logger.info(f"Initialized Gemini models: primary='{MODELS[0]}', fallbacks={MODELS[1:]}")

# Per-request Gemini API timeout (ms). The SDK default is effectively infinite.
# 10 000 ms is aggressive but recoverable via the fallback chain.
# Raise to 15 000 if you observe legitimate cold-start timeouts on warm deployments.
REQUEST_TIMEOUT_MS = int(os.getenv("GEMINI_REQUEST_TIMEOUT_MS", "10000"))

# Deterministic local regex fast-path for common Tamil/Tanglish/English structured notes.
# Completes in < 2 ms and avoids Gemini round-trips for simple transactions.
ENABLE_LOCAL_EXTRACTOR = os.getenv("ENABLE_LOCAL_EXTRACTOR", "true").lower() == "true"

# Models that support thinking_budget=0 to disable internal chain-of-thought.
# gemini-3.5-flash-lite does NOT support thinking config — it raises 400 INVALID_ARGUMENT.
_THINKING_SUPPRESSED_MODELS = {"gemini-3.5-flash", "gemini-3.6-flash"}

# Transient error codes that justify trying the next fallback model.
_TRANSIENT_HTTP_CODES = {429, 500, 503, 504}
# Error keywords that indicate quota/traffic problems (also transient).
_TRANSIENT_KEYWORDS = ("UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED", "quota", "rate limit", "overloaded")

PROMPT = """You read a shopkeeper's spoken or typed note about a customer's account.
The language may be Tamil, Tanglish (Tamil written in English letters) or English.
Return only JSON that matches the schema.

Rules:
- kind:
  * "credit" when only goods/items were taken on credit.
  * "payment" when only money/cash was paid back by the customer.
  * "combined" when the note mentions BOTH a repayment AND a new credit purchase in the same interaction (e.g. customer paid some money and also took groceries on credit).
- operations:
  * For "combined": provide each financial operation in order:
    1. type: "payment" with total_rupees set to repayment amount, and items empty.
    2. type: "credit" with total_rupees set to new credit purchase amount, and items set to products taken.
  * For "credit" or "payment": operations can contain that single operation.
- customer_name: the customer's name, written in English letters. Empty string if none was said.
- items: each product with quantity and unit (kg, g, L, ml, packet, piece). Use English product names
  (paruppu = Dal, arisi = Rice, paal = Milk, sakkarai = Sugar, ennai = Oil).
  Never fabricate item details if the merchant only stated a purchase amount.
- price_rupees: ONLY if a price for that single item was spoken, otherwise null. Never guess prices.
- total_rupees: the total amount spoken, as a number. null if no total was spoken. Never add up guessed prices.
  For "combined", this can be null or the new credit purchase amount.
- transcript: a short plain transcript of what was said.
- confidence: "high" if every field is clear, "medium" if something is uncertain (such as ambiguous payment vs credit direction), "low" if the audio or sentence was unclear.
"""


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
    customer_name: str
    items: list[Item] = []
    total_rupees: Optional[float] = None
    operations: list[Operation] = []
    transcript: str = ""
    confidence: Literal["high", "medium", "low"]


class DraftResponse(Draft):
    metrics: Optional[dict] = None


class TextIn(BaseModel):
    text: str


app = FastAPI(title="CredYazh AI service")

_cached_client = None


def _client():
    global _cached_client
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise HTTPException(503, "GEMINI_API_KEY is not set in ai-service/.env")
    if _cached_client is None:
        from google import genai
        _cached_client = genai.Client(api_key=key)
    return _cached_client


def _build_config(model_name: str, extra_kwargs: dict | None = None) -> "types.GenerateContentConfig":
    """Build a GenerateContentConfig with consistent defaults.

    Key choices:
    - temperature=0  : deterministic extraction, no creative variation.
    - thinking_budget=0 : disables chain-of-thought on supported models (saves 400–600 ms).
      gemini-3.5-flash-lite does NOT support ThinkingConfig and raises 400;
      we skip it for that model.
    - timeout : hard wall-clock limit per model attempt so that a stalled
      model is abandoned quickly and the next fallback is tried.
    """
    from google.genai import types as _t
    kwargs: dict = dict(
        system_instruction=PROMPT,
        response_mime_type="application/json",
        response_schema=Draft,
        temperature=0,
        http_options=_t.HttpOptions(timeout=REQUEST_TIMEOUT_MS),
    )
    if model_name in _THINKING_SUPPRESSED_MODELS:
        # thinking_budget=0 disables chain-of-thought tokens entirely on supported models.
        kwargs["thinking_config"] = _t.ThinkingConfig(thinking_budget=0)
    if extra_kwargs:
        kwargs.update(extra_kwargs)
    return _t.GenerateContentConfig(**kwargs)


def _classify_error(err_str: str) -> str:
    """Return 'transient', 'auth', 'not_found', or 'blocked'."""
    if any(code in err_str for code in ("401", "403", "API_KEY_INVALID", "PERMISSION_DENIED")):
        return "auth"
    if "404" in err_str or "not found" in err_str.lower():
        return "not_found"
    if "model output must contain either output text or tool calls" in err_str:
        return "blocked"
    # Transient: server overloaded / rate limited / deadline exceeded
    if any(kw in err_str for kw in _TRANSIENT_KEYWORDS):
        return "transient"
    for code in _TRANSIENT_HTTP_CODES:
        if str(code) in err_str:
            return "transient"
    return "error"


def _ask(contents) -> DraftResponse:
    from google.genai import types
    client = _client()
    t_start = time.perf_counter()
    models_attempted = []
    last_err = None

    for model_name in MODELS:
        t_model_start = time.perf_counter()
        try:
            logger.info(f"Draft extraction attempting model '{model_name}'")
            resp = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=_build_config(model_name),
            )
            t_gen = (time.perf_counter() - t_model_start) * 1000

            t_val_start = time.perf_counter()
            validated = Draft.model_validate_json(resp.text)
            t_val = (time.perf_counter() - t_val_start) * 1000
            t_total = (time.perf_counter() - t_start) * 1000

            usage = getattr(resp, "usage_metadata", None)
            models_attempted.append({
                "model": model_name,
                "latency_ms": round(t_gen, 1),
                "status": "ok",
                "prompt_tokens": getattr(usage, "prompt_token_count", None),
                "candidate_tokens": getattr(usage, "candidates_token_count", None),
                "thought_tokens": getattr(usage, "thoughts_token_count", None),
            })
            logger.info(f"Model '{model_name}' succeeded in {t_gen:.0f}ms (total {t_total:.0f}ms)")

            return DraftResponse(
                **validated.model_dump(),
                metrics={
                    "model": model_name,
                    "gemini_latency_ms": round(t_gen, 1),
                    "validation_latency_ms": round(t_val, 1),
                    "ai_total_latency_ms": round(t_total, 1),
                    "models_attempted": models_attempted
                }
            )
        except HTTPException:
            raise
        except Exception as e:
            dt = (time.perf_counter() - t_model_start) * 1000
            err_str = str(e)
            error_class = _classify_error(err_str)

            if error_class == "blocked":
                logger.warning(
                    f"Model '{model_name}' returned an empty/blocked response after {dt:.0f}ms "
                    "(safety filter or unsupported input). Trying next model."
                )
            else:
                logger.warning(f"Model '{model_name}' failed ({error_class}) after {dt:.0f}ms: {err_str[:200]}")

            models_attempted.append({
                "model": model_name,
                "latency_ms": round(dt, 1),
                "status": error_class,
                "error": err_str[:200]
            })
            last_err = e

            # Auth errors: no point trying other models with the same key
            if error_class == "auth":
                raise HTTPException(503, f"Gemini API authentication failed: {err_str}")

            # All other classes (transient, not_found, blocked, generic error):
            # continue to the next fallback model.
            continue

    tried_summary = ", ".join(f"{m['model']} ({m['status']})" for m in models_attempted)
    raise HTTPException(502, f"All configured models failed: [{tried_summary}]. Last error: {last_err}")


@app.get("/health")
def health():
    return {
        "ok": True,
        "primary_model": MODELS[0] if MODELS else None,
        "configured_models": MODELS,
        "total_models": len(MODELS)
    }


@app.post("/draft/text", response_model=DraftResponse)
def draft_text(body: TextIn):
    if ENABLE_LOCAL_EXTRACTOR:
        try:
            from credyazh_local_extractor import try_local_extract
            t0 = time.perf_counter()
            local_draft = try_local_extract(body.text)
            if local_draft is not None:
                dt_ms = (time.perf_counter() - t0) * 1000
                logger.info(f"Local fast-path extracted draft in {dt_ms:.2f}ms for: {body.text[:40]}")
                local_draft.pop("_source", None)
                validated = Draft.model_validate(local_draft)
                return DraftResponse(
                    **validated.model_dump(),
                    metrics={
                        "model": "local_regex_fastpath",
                        "gemini_latency_ms": 0.0,
                        "validation_latency_ms": round(dt_ms, 2),
                        "ai_total_latency_ms": round(dt_ms, 2),
                        "models_attempted": [{
                            "model": "local_regex_fastpath",
                            "latency_ms": round(dt_ms, 2),
                            "status": "ok"
                        }]
                    }
                )
        except Exception as e:
            logger.warning(f"Local extraction error: {e}, falling through to Gemini")
    return _ask([body.text])


@app.post("/draft/audio", response_model=DraftResponse)
async def draft_audio(request: Request):
    from google.genai import types
    data = None
    mime = "audio/wav"

    content_type = request.headers.get("content-type", "").lower()

    # 1. Handle JSON with base64 audio (recommended for serverless environments)
    if "application/json" in content_type:
        try:
            body = await request.json()
            b64_str = body.get("audio_base64") or body.get("audio") or ""
            if not b64_str:
                raise HTTPException(400, "empty audio_base64 in JSON payload")
            data = base64.b64decode(b64_str)
            mime = body.get("mime_type") or body.get("mimetype") or "audio/wav"
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"Invalid base64 audio payload: {e}")

    # 2. Handle raw binary audio (e.g. audio/wav or application/octet-stream)
    elif "audio/" in content_type or "application/octet-stream" in content_type:
        data = await request.body()
        mime = content_type.split(";")[0] or "audio/wav"

    # 3. Handle multipart form-data (with safe exception handling)
    else:
        try:
            form = await request.form()
            file = form.get("audio")
            if file and hasattr(file, "read"):
                data = await file.read()
                mime = getattr(file, "content_type", "audio/wav")
            elif file and isinstance(file, (bytes, bytearray)):
                data = file
        except Exception as e:
            logger.warning(f"Multipart parse error: {e}. Trying raw body fallback.")
            raw = await request.body()
            if raw:
                data = raw
                mime = "audio/wav"

    if not data:
        raise HTTPException(400, "Empty audio data received")

    return _ask([types.Part.from_bytes(data=data, mime_type=mime), "Read this note."])


# ─── WhatsApp message generation ─────────────────────────────
class TransactionLine(BaseModel):
    date: str
    type: Literal["credit", "payment", "reversal"]
    description: str
    amount_rupees: float


class WhatsAppMessageRequest(BaseModel):
    shop_name: str
    customer_name: str
    balance_rupees: float
    total_credit_rupees: float
    total_payment_rupees: float
    recent_transactions: list[TransactionLine]
    language: Literal["english", "tamil", "tanglish"] = "english"


class WhatsAppMessageResponse(BaseModel):
    message: str
    language: str


WA_PROMPT_TEMPLATE = """You are a polite customer relationship assistant for an Indian grocery shop called "{shop_name}".

Write a friendly WhatsApp account statement message to the customer named "{customer_name}" in {language_instruction}.

Rules:
- Be warm, respectful, and professional.
- Include the shop name as the sender.
- Show the current outstanding balance prominently.
- Summarize recent transactions clearly (credit vs repayment).
- Do NOT fabricate any numbers — use only the data provided.
- End with a polite thank you and invitation to contact if there are any discrepancies.
- Keep the message concise but complete (under 300 words).
- Use ₹ for amounts. Format amounts as ₹X,XXX (e.g. ₹1,250).
- Do not use any markdown formatting — plain text only, suitable for WhatsApp.
- {language_extra}

Account data:
Customer: {customer_name}
Outstanding Balance: ₹{balance_rupees:.2f}
Total Credit Given (all time): ₹{total_credit_rupees:.2f}
Total Repayments (all time): ₹{total_payment_rupees:.2f}

Recent Transactions:
{transaction_lines}

Return ONLY the WhatsApp message text, nothing else.
"""

LANGUAGE_INSTRUCTIONS = {
    "english": ("English", "Use formal but friendly English."),
    "tamil": ("Tamil (தமிழ்)", "Write in Tamil script. Use respectful language (நீங்கள் / உங்கள்)."),
    "tanglish": ("Tanglish (Tamil written in English letters)", "Write in Tanglish — Tamil words written using English alphabet. E.g. 'Vanakkam Kumar, ungal account pathi oru update...'"),
}


@app.post("/whatsapp-message", response_model=WhatsAppMessageResponse)
def generate_whatsapp_message(body: WhatsAppMessageRequest):
    lang_label, lang_extra = LANGUAGE_INSTRUCTIONS.get(body.language, LANGUAGE_INSTRUCTIONS["english"])

    tx_lines = "\n".join(
        f"  - {t.date}: {t.description} ({t.type.capitalize()}) ₹{t.amount_rupees:.2f}"
        for t in body.recent_transactions
    ) or "  (No transactions recorded yet)"

    prompt = WA_PROMPT_TEMPLATE.format(
        shop_name=body.shop_name,
        customer_name=body.customer_name,
        language_instruction=lang_label,
        language_extra=lang_extra,
        balance_rupees=body.balance_rupees,
        total_credit_rupees=body.total_credit_rupees,
        total_payment_rupees=body.total_payment_rupees,
        transaction_lines=tx_lines,
    )

    from google import genai
    from google.genai import types

    try:
        client = _client()
        for model_name in MODELS:
            try:
                logger.info(f"Generating WhatsApp message with model '{model_name}'")
                resp = client.models.generate_content(
                    model=model_name,
                    contents=[prompt],
                    config=types.GenerateContentConfig(temperature=0.4),
                )
                return WhatsAppMessageResponse(message=resp.text.strip(), language=body.language)
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"WhatsApp message generation failed with '{model_name}': {e}")
                continue
    except HTTPException:
        raise
    except Exception:
        pass

    # Reliable template fallback (never fabricates data)
    if body.language == "tanglish":
        fallback = (
            f"Vanakkam {body.customer_name},\n\n"
            f"{body.shop_name} irundhu ungal account pathi oru update:\n\n"
            f"Current balance: \u20b9{body.balance_rupees:,.2f}\n"
            f"Total credit: \u20b9{body.total_credit_rupees:,.2f}\n"
            f"Total repayments: \u20b9{body.total_payment_rupees:,.2f}\n\n"
            f"Ungal support-ku nandri. Enna thappu irundhaal, engalai contact pannungal.\n\n"
            f"Regards,\n{body.shop_name}"
        )
    elif body.language == "tamil":
        fallback = (
            f"வணக்கம் {body.customer_name},\n\n"
            f"{body.shop_name} இல் இருந்து உங்கள் கணக்கு விவரம்:\n\n"
            f"நிலுவை தொகை: \u20b9{body.balance_rupees:,.2f}\n"
            f"மொத்த கடன்: \u20b9{body.total_credit_rupees:,.2f}\n"
            f"மொத்த திருப்பிச் செலுத்தியது: \u20b9{body.total_payment_rupees:,.2f}\n\n"
            f"உங்கள் ஆதரவிற்கு நன்றி. ஏதேனும் வேறுபாடு இருந்தால் எங்களை தொடர்பு கொள்ளுங்கள்.\n\n"
            f"நன்றி,\n{body.shop_name}"
        )
    else:
        fallback = (
            f"Hello {body.customer_name},\n\n"
            f"Greetings from {body.shop_name}!\n\n"
            f"Here is a friendly update on your account:\n\n"
            f"Outstanding Balance: \u20b9{body.balance_rupees:,.2f}\n"
            f"Total Credit Given: \u20b9{body.total_credit_rupees:,.2f}\n"
            f"Total Repayments: \u20b9{body.total_payment_rupees:,.2f}\n\n"
            f"Thank you for your continued support. Please contact us if you notice any discrepancy.\n\n"
            f"Regards,\n{body.shop_name}"
        )

    return WhatsAppMessageResponse(message=fallback, language=body.language)

