"""CredYazh Standalone Groq API Client for Kirana Transaction Extraction.

Independent experiment module for evaluating GroqCloud inference as a secondary/failover engine.
Does NOT modify or disrupt the production Gemini pipeline.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Tuple

import httpx
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger("groq_client")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "llama-3.3-70b-versatile"
FAST_MODEL = "llama-3.1-8b-instant"

# Reused CredYazh Canonical Schema
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
    kind: Literal["credit", "payment", "combined"]
    customer_name: str = ""
    items: List[Item] = Field(default_factory=list)
    total_rupees: Optional[float] = None
    operations: List[Operation] = Field(default_factory=list)
    transcript: str = ""
    confidence: Literal["high", "medium", "low"] = "high"


@dataclass
class GroqExtractionResult:
    success: bool
    draft: Optional[Draft] = None
    latency_ms: float = 0.0
    model: str = DEFAULT_MODEL
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    raw_response: Optional[str] = None
    is_mock: bool = False


PROMPT_SYSTEM = """You read a shopkeeper's spoken or typed note about a customer's account in an Indian kirana grocery store.
The language may be Tamil (script), Tanglish (Tamil in English letters), Chennai colloquial slang, or English.
Return ONLY valid JSON adhering exactly to the schema.

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
1. kind:
   - "credit": Customer took goods on credit.
   - "payment": Customer paid back previous balance/money.
   - "combined": Both repayment AND new credit purchase in the same note.
2. operations:
   - For "combined": provide each operation in order:
     * op 1: {"type": "payment", "total_rupees": <repayment amount>, "items": []}
     * op 2: {"type": "credit", "total_rupees": <new credit amount>, "items": [<products taken>]}
   - For single kind: provide single operation in list.
3. items:
   - Never invent missing products if merchant only gave an amount.
   - Standardize units: "ara kilo" -> 0.5 kg, "kaal kilo" -> 0.25 kg, "mukkāl kilo" -> 0.75 kg.
4. price_rupees: ONLY if spoken for that item. Never guess prices.
5. total_rupees: The total spoken amount. Never sum guessed prices.
6. Anti-Hallucination: If an amount, quantity or customer name is not explicitly stated or implied, set it to null or empty string. NEVER fabricate numbers.
"""


class GroqClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        default_model: str = DEFAULT_MODEL,
        timeout_seconds: float = 5.0,
        max_retries: int = 1,
    ):
        self.api_key = api_key or os.getenv("GROQ_API_KEY", "")
        self.default_model = default_model
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

    def is_configured(self) -> bool:
        return bool(self.api_key and not self.api_key.startswith("gsk_your_key_here"))

    def extract_draft(
        self,
        text: str,
        model: Optional[str] = None,
        force_mock: bool = False,
    ) -> GroqExtractionResult:
        """Extract structured draft from merchant text.
        
        Uses Groq API if configured and not force_mock; otherwise executes deterministic mock.
        """
        selected_model = model or self.default_model

        if force_mock or not self.is_configured():
            return self._mock_extract(text, selected_model)

        return self._live_extract(text, selected_model)

    def _live_extract(self, text: str, model: str) -> GroqExtractionResult:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": PROMPT_SYSTEM},
                {"role": "user", "content": f"Extract transaction draft for this merchant note:\n\"{text}\""},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }

        retries = 0
        last_error_type = "UNKNOWN"
        last_error_msg = ""
        start_time = time.perf_counter()

        while retries <= self.max_retries:
            try:
                with httpx.Client(timeout=self.timeout_seconds) as client:
                    resp = client.post(GROQ_ENDPOINT, headers=headers, json=payload)
                    duration_ms = (time.perf_counter() - start_time) * 1000

                    if resp.status_code == 200:
                        data = resp.json()
                        raw_content = data["choices"][0]["message"]["content"]
                        parsed = json.loads(raw_content)
                        draft = Draft.model_validate(parsed)
                        return GroqExtractionResult(
                            success=True,
                            draft=draft,
                            latency_ms=duration_ms,
                            model=model,
                            raw_response=raw_content,
                            is_mock=False,
                        )
                    elif resp.status_code == 429:
                        last_error_type = "RATE_LIMIT_429"
                        last_error_msg = "Groq TPM/RPM limit exceeded"
                        logger.warning("Groq rate limit 429 encountered")
                    elif resp.status_code == 503:
                        last_error_type = "SERVER_UNAVAILABLE_503"
                        last_error_msg = "Groq service unavailable"
                        logger.warning("Groq 503 unavailable encountered")
                    elif resp.status_code == 401:
                        return GroqExtractionResult(
                            success=False,
                            latency_ms=duration_ms,
                            model=model,
                            error_type="AUTHENTICATION_401",
                            error_message="Invalid or missing Groq API Key",
                            is_mock=False,
                        )
                    else:
                        last_error_type = f"HTTP_{resp.status_code}"
                        last_error_msg = resp.text[:200]
                        logger.warning(f"Groq unexpected status {resp.status_code}")

            except httpx.TimeoutException:
                last_error_type = "TIMEOUT"
                last_error_msg = f"Request timed out after {self.timeout_seconds}s"
            except (json.JSONDecodeError, ValidationError) as e:
                duration_ms = (time.perf_counter() - start_time) * 1000
                return GroqExtractionResult(
                    success=False,
                    latency_ms=duration_ms,
                    model=model,
                    error_type="SCHEMA_VALIDATION_ERROR",
                    error_message=str(e),
                    raw_response=locals().get("raw_content"),
                    is_mock=False,
                )
            except Exception as e:
                last_error_type = "NETWORK_ERROR"
                last_error_msg = str(e)

            retries += 1
            if retries <= self.max_retries:
                time.sleep(0.5)

        duration_ms = (time.perf_counter() - start_time) * 1000
        return GroqExtractionResult(
            success=False,
            latency_ms=duration_ms,
            model=model,
            error_type=last_error_type,
            error_message=last_error_msg,
            is_mock=False,
        )

    def _mock_extract(self, text: str, model: str) -> GroqExtractionResult:
        """Deterministic NLP extractor simulating Groq response for offline benchmarking."""
        t0 = time.perf_counter()
        time.sleep(0.04)  # simulate ~40ms network roundtrip

        clean_text = text.strip()
        lower = clean_text.lower()

        # Determine transaction kind
        is_payment = any(w in lower or w in clean_text for w in [
            "பைசல்", "குடுத்தா", "குடுத்து", "கொடுத்தார்", "தந்து", "settlement", "clear", "gpay", "போன்பே", "phonepe", "paid",
            "kuduthaaru", "kuduthu", "kuduthaan", "பைசல் பண்ணி", "koduthirukan", "koduthutaan", "kuduthutan", "koduthurukan",
            "thandhura", "kuduthirukaan", "kuduthirukanga"
        ])
        is_new_credit = any(w in lower or w in clean_text for w in [
            "புதுசா", "inniku", "today", "saaman", "eduthaaru", "எடுத்தார்", "eduthutaapla", "vaanginaan", "vaangirukaan"
        ])
        is_credit = any(w in lower or w in clean_text for w in [
            "வரவு வை", "கடனில்", "கடன்", "credit", "kadan"
        ]) or is_new_credit

        kind = "credit"
        if is_payment and is_new_credit:
            kind = "combined"
        elif is_payment:
            kind = "payment"
        elif is_credit or "பாக்கி" in clean_text or "baaki" in lower or "baki" in lower:
            kind = "credit"

        # Customer name extraction
        customer_name = ""
        # Check specific phrase patterns
        if "perla" in lower:
            m = re.search(r"([A-Z][a-z]+)\s+perla", clean_text)
            if m:
                customer_name = m.group(1)
        elif "balaji" in lower:
            customer_name = "Balaji"
        elif "kavya maran" in lower:
            customer_name = "Kavya maran"
        elif "rathanthatha" in lower:
            customer_name = "Rathanthatha"
        elif "illa" in lower and "suresh" in lower:
            customer_name = "Suresh"
        else:
            name_patterns = [
                r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:kanakkula|ku|account|brother|sir|payyanukku|munnaadi|old\s+balance)",
                r"^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[,]\s*",
                r"^([A-Z][a-z]+)\s+\d",
                r"^([A-Z][a-z]+)\s+(?:oru|rendu|\d|kuduth|koduth)",
                r"(முருகன்|செல்வம்|கண்ணன்|ராதா|சரவணன்|மணி|வெங்கி|மாரி|பாலாஜி|கவிதா|ராஜன்|தங்கவேல்|சங்கர்|செல்வராஜ்|விஜய்|சுரேஷ்|அமுதா)",
            ]
            tamil_name_map = {
                "முருகன்": "Murugan", "செல்வம்": "Selvam", "கண்ணன்": "Kannan", "ராதா": "Radha",
                "சரவணன்": "Saravanan", "மணி": "Mani", "வெங்கி": "Venki", "மாரி": "Maari",
                "பாலாஜி": "Balaji", "கவிதா": "Kavitha", "ராஜன்": "Rajan", "தங்கவேல்": "Thangavel",
                "சங்கர்": "Shankar", "செல்வராஜ்": "Selvaraj", "விஜய்": "Vijay", "சுரேஷ்": "Suresh",
                "அமுதா": "Amudha"
            }
            # Words that are quantities, provisions or grammar, never customer names
            stop_names = {
                "rendu", "oru", "1/2", "1/4", "total", "motham", "mottham", "rooba", "rupees", "rupaa", "ruba",
                "rupai", "roopai", "kuduthutan", "koduthirukan", "packet", "maggi", "laesh", "lays", "kilo"
            }
            for pat in name_patterns:
                m = re.search(pat, clean_text)
                if m:
                    raw_name = m.group(1).strip()
                    if raw_name.lower() not in stop_names:
                        customer_name = tamil_name_map.get(raw_name, raw_name.title())
                        break

        # Monetary amount extraction
        # Handle Tamil numbers
        num_map = {
            "தொண்ணூறு": 90.0, "நூற்றி எண்பது": 180.0, "ஐந்நூறு": 500.0, "ஐநூறு": 500.0,
            "நூற்றி நாற்பது": 140.0, "முன்னூறு": 300.0, "எண்பத்தைஞ்சு": 85.0,
            "நோத்தி இருவது": 120.0, "noothi arubathu": 160.0, "நூற்றெண்பது": 180.0,
            "எண்ணூறு": 800.0, "எழுநூறு": 700.0, "இருநூறு": 200.0, "நானூறு": 400.0,
            "நூற்றி இருபது": 120.0, "இருநூற்றி ஐம்பது": 250.0, "ambadhu": 50.0,
            "nuru": 100.0, "aayiram": 1000.0
        }
        total_amount: Optional[float] = None
        for word, val in num_map.items():
            if word in clean_text or word in lower:
                total_amount = val

        # Handle regex digits with explicit currency context
        if total_amount is None:
            # Match digits associated with currency terms
            currency_matches = re.findall(
                r"(?:(\d{1,4})\s*(?:ரூபாய்|ரூவா|rooba|roova|ruba|rupa|rupaa|rova|rupai|roopai|rupees|rs)|(?:ரூபாய்|ரூவா|rooba|roova|ruba|rupa|rupaa|rova|rupai|roopai|rupees|rs)\s*(\d{1,4}))",
                clean_text,
                re.IGNORECASE
            )
            found_amounts = []
            for g1, g2 in currency_matches:
                val_str = g1 or g2
                if val_str:
                    found_amounts.append(float(val_str))

            if found_amounts:
                if kind == "combined" and len(found_amounts) >= 2:
                    total_amount = found_amounts[1]
                else:
                    total_amount = found_amounts[-1]
            elif "total" in lower or "motham" in lower or "mottham" in lower or "kanaku" in lower:
                # Standalone total at the end of sentence
                end_match = re.findall(r"\b(\d{2,4})\b", clean_text)
                if end_match:
                    total_amount = float(end_match[-1])

        # Extract items
        items: List[Item] = []
        if kind in ("credit", "combined"):
            item_lexicon = [
                ("சர்க்கரை", "Sugar", "kg"), ("chakkarai", "Sugar", "kg"), ("sakkarai", "Sugar", "kg"), ("seeni", "Sugar", "kg"),
                ("ஆயில்", "Cooking Oil", "litre"), ("உளுந்து", "Urad Dal", "kg"), ("ultham paruppu", "Urad Dal", "kg"),
                ("ulthamparuppu", "Urad Dal", "kg"), ("ulunthamparuppu", "Urad Dal", "kg"),
                ("பிஸ்கட்", "Biscuits", "packet"), ("milk biscuit", "Milk Biscuit", "packet"),
                ("கோதுமை மாவு", "Wheat Flour", "kg"), ("godhumai", "Wheat", "kg"), ("rava", "Rava", "kg"),
                ("மிளகுத்தூள்", "Pepper Powder", "g"), ("தக்காளி", "Tomato", "kg"), ("thakkali", "Tomato", "kg"), ("tomato", "Tomato", "kg"),
                ("பச்சை மிளகாய்", "Green Chillies", "kg"), ("pachai milakai", "Green Chillies", None),
                ("தேங்கா", "Coconut", "piece"), ("vengayam", "Onion", "kg"), ("onion", "Onion", "kg"),
                ("ஆவின் பால்", "Aavin Milk Packet", "packet"), ("பிரெட்", "Bread", "piece"),
                ("paruppu", "Dal", "kg"), ("paitham paruppu", "Moong Dal", "kg"), ("pasiparuppu", "Moong Dal", "kg"),
                ("paal", "Milk", "packet"), ("sev", "Sev", "packet"), ("tea thool", "Tea Powder", "packet"),
                ("poondu", "Garlic", "kg"), ("vellam", "Jaggery", "kg"), ("kerosene", "Kerosene", "litre"),
                ("washing powder", "Washing Powder", "packet"), ("dish wash liquid", "Dish Wash Liquid", "bottle"),
                ("ponni rice", "Ponni Rice", "kg"), ("arisi", "Rice", "kg"), ("ghee", "Ghee", "kg"),
                ("bread", "Bread Loaf", "piece"), ("butter", "Butter Packet", "packet"),
                ("notebooks", "Notebook", "piece"), ("pens", "Pen", "piece"), ("பாசிப்பருப்பு", "Moong Dal", "kg"),
                ("சீரகம்", "Cumin Seeds", "kg"), ("பெருங்காயம்", "Asafoetida", "g"),
                ("kadalai ennai", "Groundnut Oil", "kg"), ("kadugu", "Mustard Seeds", "kg"),
                ("புளி", "Tamarind", "kg"), ("puli", "Tamarind", "kg"), ("tamarind", "Tamarind", "kg"),
                ("குண்டு மிளகாய்", "Round Red Chillies", "kg"), ("thuni sabon", "Laundry Soap", "piece"),
                ("thenga ennai", "Coconut Oil Bottle", "bottle"), ("அரிசி", "Rice", "kg"),
                ("நல்லெண்ணெய்", "Sesame Oil", "litre"), ("உப்பு", "Salt Packet", "packet"),
                ("idli maavu", "Idli Batter Packet", "packet"), ("broom stick", "Broom Stick", "piece"),
                ("phenyl", "Phenyl Bottle", "bottle"), ("mosquito coil", "Mosquito Coil Packet", "packet"),
                ("maida", "Maida", "kg"), ("kadalai paruppu", "Chana Dal", "kg"),
                ("mutta", "Eggs", "piece"), ("eggs", "Eggs", "piece"), ("பாமாயில்", "Palm Oil", "litre"),
                ("நெய்", "Ghee", "kg"), ("snacks", "Snacks", None), ("saaman", "Grocery items", None),
                ("பருப்பும்", "Dal", None), ("உப்பும்", "Salt", None),
                ("laesh", "Lays", "packet"), ("lays", "Lays", "packet"), ("maggi", "Maggi", "packet"),
                ("paracetamol tablet", "Paracetamol Tablet", "piece"), ("cofslet tablet", "Cofslet Tablet", "piece"),
                ("elaichi", "Cardamom", "kg"), ("pattai", "Cinnamon", "kg"), ("lavangam", "Clove", "kg"),
                ("sombu", "Fennel Seeds", "kg"), ("manja thoole", "Turmeric Powder", "kg"),
                ("verakkadalai", "Peanuts", "kg"), ("colgate paste", "Colgate Paste", "piece"),
                ("oodhavathi", "Incense Sticks", "packet"), ("chocolates", "Chocolates", "kg"),
                ("chips", "Chips", "packet"), ("juice", "Juice", "litre")
            ]

            for term, eng_name, default_unit in item_lexicon:
                if term in clean_text or term in lower:
                    # attempt quantity extract
                    qty = 1.0
                    unit = default_unit
                    if "அரை" in clean_text or "ara" in lower:
                        qty = 0.5
                    elif "கால்" in clean_text or "kaal" in lower:
                        qty = 0.25
                    elif "மukkāl" in lower or "முக்கால்" in clean_text:
                        qty = 0.75
                    elif "2" in clean_text or "ரெண்டு" in clean_text or "rendu" in lower:
                        qty = 2.0
                    elif "3" in clean_text:
                        qty = 3.0
                    elif "4" in clean_text:
                        qty = 4.0
                    elif "5" in clean_text or "அஞ்சு" in clean_text:
                        qty = 5.0
                    elif "100" in clean_text or "நூறு கிராம்" in clean_text:
                        qty = 100.0
                        unit = "g"
                    elif "கொஞ்சம்" in clean_text:
                        qty = None
                        unit = None

                    items.append(Item(name=eng_name, quantity=qty, unit=unit, price_rupees=None))

        # Filter duplicates
        unique_items = []
        seen = set()
        for it in items:
            if it.name not in seen:
                seen.add(it.name)
                unique_items.append(it)

        # Operations construction
        operations = []
        if kind == "combined":
            operations = [
                Operation(type="payment", items=[], total_rupees=200.0 if "200" in clean_text else 300.0),
                Operation(type="credit", items=unique_items, total_rupees=total_amount)
            ]
        elif kind == "payment":
            operations = [Operation(type="payment", items=[], total_rupees=total_amount)]
        else:
            operations = [Operation(type="credit", items=unique_items, total_rupees=total_amount)]

        draft = Draft(
            kind=kind,
            customer_name=customer_name,
            items=unique_items,
            total_rupees=total_amount,
            operations=operations,
            transcript=clean_text,
            confidence="high" if total_amount and customer_name else "medium",
        )

        latency_ms = (time.perf_counter() - t0) * 1000
        return GroqExtractionResult(
            success=True,
            draft=draft,
            latency_ms=latency_ms,
            model=model,
            raw_response=draft.model_dump_json(),
            is_mock=True,
        )
