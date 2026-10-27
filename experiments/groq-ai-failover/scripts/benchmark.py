"""CredYazh Groq Extraction Benchmark Runner.

Executes test suite from `datasets/sample_transactions.json` against Groq models.
Calculates precision, recall, financial accuracy, hallucination rates, and latency percentiles.
Saves detailed JSON and markdown metrics to `results/`.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add experiment root to path
EXPERIMENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(EXPERIMENT_ROOT / "scripts"))

from groq_client import DEFAULT_MODEL, FAST_MODEL, Draft, GroqClient, GroqExtractionResult

logger = logging.getLogger("benchmark")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def calculate_percentile(values: List[float], percentile: float) -> float:
    if not values:
        return 0.0
    sorted_v = sorted(values)
    k = (len(sorted_v) - 1) * (percentile / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_v[int(k)]
    d0 = sorted_v[int(f)] * (c - k)
    d1 = sorted_v[int(c)] * (k - f)
    return d0 + d1


class BenchmarkRunner:
    def __init__(
        self,
        dataset_path: Path,
        results_dir: Path,
        model: str = DEFAULT_MODEL,
        force_mock: bool = False,
    ):
        self.dataset_path = dataset_path
        self.results_dir = results_dir
        self.model = model
        self.force_mock = force_mock
        self.client = GroqClient(default_model=model)

    def run(self) -> Dict[str, Any]:
        with open(self.dataset_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        cases = data.get("cases", [])
        total_cases = len(cases)
        logger.info(f"Loaded {total_cases} test cases from {self.dataset_path.name}")
        logger.info(f"Target model: {self.model} (Force Mock: {self.force_mock}, Configured: {self.client.is_configured()})")

        results = []
        latencies: List[float] = []

        customer_matches = 0
        intent_matches = 0
        amount_matches = 0
        hallucination_violations = 0
        json_valid_count = 0
        item_extractions_correct = 0
        total_expected_items = 0

        for idx, tc in enumerate(cases, 1):
            tc_id = tc["id"]
            category = tc.get("category", "")
            input_text = tc["input_text"]
            expected = tc["expected"]

            res: GroqExtractionResult = self.client.extract_draft(
                text=input_text,
                model=self.model,
                force_mock=self.force_mock,
            )

            latencies.append(res.latency_ms)
            if res.success and res.draft is not None:
                json_valid_count += 1
                draft = res.draft

                # 1. Customer Name Check (fuzzy match)
                exp_cust = expected.get("customer_name", "").strip().lower()
                got_cust = draft.customer_name.strip().lower()
                c_match = False
                if not exp_cust and not got_cust:
                    c_match = True
                elif exp_cust and (exp_cust in got_cust or got_cust in exp_cust):
                    c_match = True
                if c_match:
                    customer_matches += 1

                # 2. Transaction Intent Check
                exp_kind = expected.get("transaction_type", "credit")
                got_kind = draft.kind
                i_match = (exp_kind == got_kind)
                if i_match:
                    intent_matches += 1

                # 3. Total Amount Check
                exp_amt = expected.get("total_amount_rupees")
                got_amt = draft.total_rupees
                a_match = False
                if exp_amt is None and got_amt is None:
                    a_match = True
                elif exp_amt is not None and got_amt is not None and abs(exp_amt - got_amt) < 0.01:
                    a_match = True
                if a_match:
                    amount_matches += 1

                # 4. Anti-Hallucination Audit
                # If expected amount was null, but draft invented an amount -> violation!
                hallucinated = False
                if exp_amt is None and got_amt is not None and got_amt > 0:
                    hallucinated = True
                    hallucination_violations += 1

                # 5. Items Extraction Check
                exp_items = expected.get("items", [])
                total_expected_items += len(exp_items)
                if exp_items:
                    matched_items = 0
                    for exp_it in exp_items:
                        for got_it in draft.items:
                            if exp_it["name"].lower() in got_it.name.lower() or got_it.name.lower() in exp_it["name"].lower():
                                matched_items += 1
                                break
                    item_extractions_correct += min(matched_items, len(exp_items))
                elif not draft.items:
                    # Both empty
                    pass

                case_result = {
                    "id": tc_id,
                    "category": category,
                    "input_text": input_text,
                    "success": res.success,
                    "is_mock": res.is_mock,
                    "latency_ms": round(res.latency_ms, 2),
                    "customer_match": c_match,
                    "intent_match": i_match,
                    "amount_match": a_match,
                    "hallucinated": hallucinated,
                    "draft": draft.model_dump(),
                }
            else:
                case_result = {
                    "id": tc_id,
                    "category": category,
                    "input_text": input_text,
                    "success": False,
                    "is_mock": res.is_mock,
                    "latency_ms": round(res.latency_ms, 2),
                    "error_type": res.error_type,
                    "error_message": res.error_message,
                }

            results.append(case_result)
            logger.info(f"[{idx}/{total_cases}] {tc_id} ({category}) - Success={res.success}, Latency={res.latency_ms:.1f}ms, Mock={res.is_mock}")

        # Summary calculations
        p50 = calculate_percentile(latencies, 50)
        p95 = calculate_percentile(latencies, 95)
        p99 = calculate_percentile(latencies, 99)

        item_accuracy = (item_extractions_correct / total_expected_items * 100.0) if total_expected_items > 0 else 100.0
        customer_accuracy = (customer_matches / total_cases) * 100.0
        intent_accuracy = (intent_matches / total_cases) * 100.0
        financial_accuracy = (amount_matches / total_cases) * 100.0
        json_validity_rate = (json_valid_count / total_cases) * 100.0
        hallucination_rate = (hallucination_violations / total_cases) * 100.0

        is_mock_run = any(r.get("is_mock", False) for r in results)

        summary = {
            "model": self.model,
            "total_cases": total_cases,
            "is_mock_run": is_mock_run,
            "metrics": {
                "json_validity_rate_pct": round(json_validity_rate, 2),
                "customer_resolution_accuracy_pct": round(customer_accuracy, 2),
                "intent_classification_accuracy_pct": round(intent_accuracy, 2),
                "financial_balance_accuracy_pct": round(financial_accuracy, 2),
                "item_extraction_accuracy_pct": round(item_accuracy, 2),
                "hallucination_rate_pct": round(hallucination_rate, 2),
                "latency_p50_ms": round(p50, 2),
                "latency_p95_ms": round(p95, 2),
                "latency_p99_ms": round(p99, 2),
            },
            "acceptance_criteria": {
                "json_validity_passed": json_validity_rate >= 98.0,
                "zero_hallucination_passed": hallucination_rate == 0.0,
                "financial_accuracy_passed": financial_accuracy >= 90.0,
                "intent_accuracy_passed": intent_accuracy >= 95.0,
                "latency_p95_passed": p95 <= 1200.0,
            },
        }

        # Gate outcome
        all_passed = all(summary["acceptance_criteria"].values())
        if all_passed:
            gate_decision = "PASS"
        elif hallucination_rate == 0.0 and financial_accuracy >= 80.0:
            gate_decision = "CONDITIONAL PASS"
        else:
            gate_decision = "FAIL"

        summary["gate_decision"] = gate_decision

        report = {
            "summary": summary,
            "detailed_results": results,
        }

        self.results_dir.mkdir(parents=True, exist_ok=True)
        report_filename = f"benchmark_report_{self.dataset_path.stem}.json"
        report_file = self.results_dir / report_filename
        with open(report_file, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

        logger.info(f"Benchmark completed with gate decision: {gate_decision}")
        logger.info(f"Results written to: {report_file}")
        return report


def main():
    parser = argparse.ArgumentParser(description="CredYazh Groq Extraction Benchmark Runner")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model identifier to evaluate")
    parser.add_argument("--mock", action="store_true", help="Force deterministic mock mode without API keys")
    parser.add_argument("--dataset", default="datasets/sample_transactions.json", help="Path to evaluation dataset JSON")
    args = parser.parse_args()

    raw_path = Path(args.dataset)
    if not raw_path.is_absolute():
        dataset_file = EXPERIMENT_ROOT / raw_path
    else:
        dataset_file = raw_path

    results_dir = EXPERIMENT_ROOT / "results"

    runner = BenchmarkRunner(
        dataset_path=dataset_file,
        results_dir=results_dir,
        model=args.model,
        force_mock=args.mock,
    )
    runner.run()


if __name__ == "__main__":
    main()
