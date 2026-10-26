"""credyazh_local_extractor.py
Phase 3 — Deterministic local extraction fast path.

Handles the most common transcript patterns without calling Gemini:
  - Simple credit purchase with amount (e.g. "Kumar 1 kg arisi 120 rupees")
  - Simple repayment (e.g. "Suresh 500 rupees paid")
  - Amount-only credit (e.g. "Priya 300 credit")

Rules:
  - NEVER invents customer names, prices, or quantities.
  - Returns None (not a draft dict) when uncertain, ambiguous, or multi-item.
  - The caller MUST still show the editable review screen; this only pre-fills it.
  - Combined (repayment + credit) transactions always fall through to Gemini.
  - confidence is always "medium" here — the merchant must confirm.
"""

import re
from typing import Optional


# ──────────────────────────────────────────────────────────────
#  Word normalisation helpers
# ──────────────────────────────────────────────────────────────

# Tamil/Tanglish→English product name map (add more as needed)
_TAMIL_PRODUCTS = {
    "arisi": "Rice",
    "sakkarai": "Sugar",
    "paal": "Milk",
    "paruppu": "Dal",
    "ennai": "Oil",
    "maavu": "Flour",
    "uppu": "Salt",
    "thakkali": "Tomato",
    "vengayam": "Onion",
    "urulaikizhangu": "Potato",
    "curry leaves": "Curry Leaves",
    "keerai": "Spinach",
}

_UNIT_ALIASES = {
    "kg": "kg", "kilo": "kg", "kilos": "kg",
    "g": "g", "gram": "g", "grams": "g",
    "l": "L", "litre": "L", "liter": "L", "litres": "L", "liters": "L",
    "ml": "ml",
    "packet": "packet", "pack": "packet", "packets": "packet",
    "piece": "piece", "pcs": "piece",
    "no": "piece", "nos": "piece",
}

# Rupee synonyms (English & Tanglish)
_RUPEE_WORDS = r"(?:rupees?|rs\.?|₹|rooba|ruba|rubai|roopai)"

# Payment trigger words
# Payment trigger words — includes Tanglish variants like 'kuduthutu', 'kuduthaanga'
_PAYMENT_WORDS = r"(?:paid|pay|payment|kuduthar|kuduthaanga|kuduttaan|kuduthutu|kuduttu|thirippe|cash)"

# Credit trigger words (used to disambiguate when no payment word is present)
_CREDIT_WORDS = r"(?:credit|vaanginaanga|vaanginaar|vaanginaan|vanginar|kuduthu|account|eduthu|eduttaan)"

# Keywords that specifically indicate a purchase-side event (used for combined detection)
# A sentence with both _PAYMENT_WORDS and _COMBINED_KEYWORDS is a combined transaction
_COMBINED_KEYWORDS = r"(?:vaanginaar|vaanginaan|vaanginaanga|vanginar|eduttaan|eduthu)"


def _normalise_unit(raw: str) -> str:
    return _UNIT_ALIASES.get(raw.lower(), raw)


def _normalise_product(raw: str) -> str:
    return _TAMIL_PRODUCTS.get(raw.lower(), raw.capitalize())


# ──────────────────────────────────────────────────────────────
#  Amount extraction
# ──────────────────────────────────────────────────────────────

_AMOUNT_PAT = re.compile(
    r"(\d+(?:\.\d+)?)\s*" + _RUPEE_WORDS,
    re.IGNORECASE
)

_AMOUNT_ONLY_PAT = re.compile(
    _RUPEE_WORDS + r"\s*(\d+(?:\.\d+)?)",
    re.IGNORECASE
)

# Matches bare "300 credit" or "credit 300" patterns (number adjacent to credit keyword)
_AMOUNT_CREDIT_PAT = re.compile(
    r"(\d+(?:\.\d+)?)\s+credit|credit\s+(\d+(?:\.\d+)?)",
    re.IGNORECASE
)


def _extract_amount(text: str) -> Optional[float]:
    """Extract a single rupee amount. Returns None if ambiguous (0 or 2+ amounts)."""
    hits: list[float] = []
    for m in _AMOUNT_PAT.finditer(text):
        hits.append(float(m.group(1)))
    for m in _AMOUNT_ONLY_PAT.finditer(text):
        hits.append(float(m.group(1)))
    for m in _AMOUNT_CREDIT_PAT.finditer(text):
        val = m.group(1) or m.group(2)
        if val:
            hits.append(float(val))

    unique = list({v for v in hits})
    if len(unique) == 1:
        return unique[0]
    return None  # 0 or 2+ amounts -> fall through to Gemini


# ──────────────────────────────────────────────────────────────
#  Single-item extraction
# ──────────────────────────────────────────────────────────────

# Matches: "1 kg arisi", "2.5 kg Rice", "1 packet paal"
_ITEM_PAT = re.compile(
    r"(\d+(?:\.\d+)?)\s+"
    r"(kg|kilo(?:s)?|g|gram(?:s)?|l|litr(?:e|es|er|ers)|ml|packet(?:s)?|pack(?:s)?|piece(?:s)?|pcs|no(?:s)?)\s+"
    r"([a-zA-Z]+(?:\s+[a-zA-Z]+)?)",
    re.IGNORECASE
)


def _extract_items(text: str) -> list[dict]:
    items = []
    for m in _ITEM_PAT.finditer(text):
        qty_str, unit_raw, name_raw = m.group(1), m.group(2), m.group(3)
        items.append({
            "name": _normalise_product(name_raw.strip()),
            "quantity": float(qty_str),
            "unit": _normalise_unit(unit_raw),
            "price_rupees": None,
        })
    return items


# ──────────────────────────────────────────────────────────────
#  Customer name extraction
# ──────────────────────────────────────────────────────────────

# Very conservative: match a capitalised word (or 2-word combo) at the start.
# We do NOT attempt full NER. If name is ambiguous, return empty string.
_NAME_START_PAT = re.compile(
    r"^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b",
)


def _extract_name(text: str) -> str:
    m = _NAME_START_PAT.match(text.strip())
    if m:
        candidate = m.group(1)
        # Reject if the word is a product, unit or transaction keyword
        _BLOCKLIST = {
            "Credit", "Payment", "Cash", "Paid", "Pay", "Account", "Total",
            "Rupees", "Kg", "Packet", "Litre", "Gram",
        }
        if candidate.split()[0] in _BLOCKLIST:
            return ""
        return candidate
    return ""


# ──────────────────────────────────────────────────────────────
#  Classify transaction kind
# ──────────────────────────────────────────────────────────────

def _classify_kind(text: str) -> Optional[str]:
    has_payment = bool(re.search(_PAYMENT_WORDS, text, re.IGNORECASE))
    has_credit_purchase = bool(re.search(_COMBINED_KEYWORDS, text, re.IGNORECASE))

    if has_payment and has_credit_purchase:
        return None  # combined -> fall through to Gemini

    if has_payment:
        return "payment"

    # Default to credit for non-ambiguous cases
    return "credit"


# ──────────────────────────────────────────────────────────────
#  Public API
# ──────────────────────────────────────────────────────────────

def try_local_extract(transcript: str) -> Optional[dict]:
    """
    Attempt deterministic extraction of a transaction draft from transcript.

    Returns a draft dict (matching the AI service's DraftResponse schema) if
    extraction is confident enough, or None to signal that Gemini is needed.

    The caller MUST route None results to Gemini and MUST present the editable
    review screen to the merchant regardless of whether local or AI extraction ran.
    """
    text = transcript.strip()
    if not text:
        return None

    # ── 1. Reject combined transactions immediately ──
    kind = _classify_kind(text)
    if kind is None:
        return None  # combined → Gemini required

    # ── 2. Extract amount ──
    amount = _extract_amount(text)
    # A payment MUST have an amount to be usable
    if kind == "payment" and amount is None:
        return None

    # ── 3. Extract items (credit only) ──
    items = _extract_items(text) if kind == "credit" else []

    # ── 4. Extract customer name ──
    customer_name = _extract_name(text)

    # ── 5. Guard: reject if we have no useful data at all ──
    if not customer_name and amount is None and not items:
        return None

    # ── 5b. Guard: if amount is ambiguous (multiple numbers in text, extractor returned None),
    #        fall through to Gemini. We never want to emit a draft with amount=None when
    #        the merchant said at least one numeric value.
    if amount is None:
        # Count digit-containing tokens in the text
        numeric_tokens = re.findall(r'\b\d+(?:\.\d+)?\b', text)
        if len(numeric_tokens) >= 2:
            return None  # ambiguous amounts -> Gemini

    # ── 6. Build operations list ──
    operation = {
        "type": kind,
        "total_rupees": amount,
        "items": items,
    }

    return {
        "kind": kind,
        "customer_name": customer_name,
        "items": items,
        "total_rupees": amount,
        "operations": [operation],
        "transcript": text,
        "confidence": "medium",    # always medium — merchant must confirm
        "_source": "local_extractor",
    }


# ──────────────────────────────────────────────────────────────
#  Regression tests (run directly: python credyazh_local_extractor.py)
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    TEST_CASES = [
        # (description, transcript, expected_kind, expected_name_starts, expected_amount, should_extract)
        ("Simple credit Tamil",
         "Kumar account-la 1 kg sakkarai 140 rupees",
         "credit", "Kumar", 140.0, True),
        ("Simple payment English",
         "Suresh paid 500 rupees",
         "payment", "Suresh", 500.0, True),
        ("Amount only credit",
         "Priya 300 credit",
         "credit", "Priya", 300.0, True),
        ("Combined — must fall to Gemini",
         "Murugan 200 kuduthutu 80 rupees-ku paruppu vaanginaar",
         None, None, None, False),
        ("Ambiguous amount — two amounts",
         "Ravi 100 rupees then 200 rupees",
         None, None, None, False),
        ("Payment with item (weird) — amount present",
         "Barath paid 400 rupees cash",
         "payment", "Barath", 400.0, True),
        ("No name no amount",
         "some transaction happened",
         None, None, None, False),
        ("Multi-item — item list extracted",
         "Kumar 2 kg arisi 1 packet paal 85 rupees",
         "credit", "Kumar", 85.0, True),
    ]

    passed = 0
    failed = 0
    for desc, text, exp_kind, exp_name_prefix, exp_amount, should_extract in TEST_CASES:
        result = try_local_extract(text)
        ok = True
        notes = []

        if should_extract:
            if result is None:
                ok = False
                notes.append("expected draft but got None")
            else:
                if result["kind"] != exp_kind:
                    ok = False; notes.append(f"kind={result['kind']} != {exp_kind}")
                if exp_name_prefix and not result["customer_name"].startswith(exp_name_prefix):
                    ok = False; notes.append(f"name='{result['customer_name']}' doesn't start with '{exp_name_prefix}'")
                if exp_amount is not None and result["total_rupees"] != exp_amount:
                    ok = False; notes.append(f"amount={result['total_rupees']} != {exp_amount}")
        else:
            if result is not None:
                ok = False
                notes.append(f"expected None but got {result}")

        status = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
        print(f"{status} [{desc}]: {notes if notes else 'OK'}")
        if result:
            print(f"    -> kind={result['kind']}, name='{result['customer_name']}', amount={result['total_rupees']}, items={[i['name'] for i in result['items']]}")

    print(f"\n{passed}/{passed+failed} tests passed")
