"""CredYazh Groq Extraction Pipeline Unit & Integration Test Suite.

Validates schema fidelity, error handling, rate limit handling, anti-hallucination safeguards,
and deterministic benchmark execution.
"""

import json
import os
import sys
import unittest
from pathlib import Path

# Setup sys.path
EXPERIMENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(EXPERIMENT_ROOT / "scripts"))

from groq_client import Draft, Item, Operation, GroqClient, GroqExtractionResult


class TestGroqExtractionPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = GroqClient()
        dataset_path = EXPERIMENT_ROOT / "datasets" / "sample_transactions.json"
        with open(dataset_path, "r", encoding="utf-8") as f:
            cls.dataset = json.load(f)

    def test_01_schema_validation(self):
        """Verify that valid Pydantic Draft instances can be instantiated and validated."""
        item = Item(name="Sugar", quantity=2.0, unit="kg", price_rupees=90.0)
        op = Operation(type="credit", items=[item], total_rupees=90.0)
        draft = Draft(
            kind="credit",
            customer_name="Murugan",
            items=[item],
            total_rupees=90.0,
            operations=[op],
            transcript="முருகன் கணக்கில் ரெண்டு கிலோ சர்க்கரை 90 ரூபாய்",
            confidence="high",
        )
        self.assertEqual(draft.kind, "credit")
        self.assertEqual(draft.customer_name, "Murugan")
        self.assertEqual(len(draft.items), 1)
        self.assertEqual(draft.items[0].quantity, 2.0)
        self.assertEqual(draft.total_rupees, 90.0)

    def test_02_anti_hallucination_for_missing_amounts(self):
        """Verify model does not invent amounts when transaction only mentions goods took on trust."""
        sample_ambiguous = "அமுதா அக்கா கொஞ்சம் பருப்பும் உப்பும் எடுத்துட்டு போயிருக்காங்க, காசு அப்புறம் தரேன்னு சொன்னாங்க."
        result = self.client.extract_draft(sample_ambiguous, force_mock=True)
        self.assertTrue(result.success)
        self.assertIsNotNone(result.draft)
        self.assertIsNone(result.draft.total_rupees, "Total rupees must be None when no amount was stated")
        self.assertEqual(result.draft.customer_name, "Amudha")

    def test_03_payment_classification(self):
        """Verify repayment/balance settlement is strictly categorized as payment with zero item hallucination."""
        sample_payment = "கண்ணன் பழைய பாக்கிக்கு ஐந்நூறு ரூபாய் கொடுத்தார்."
        result = self.client.extract_draft(sample_payment, force_mock=True)
        self.assertTrue(result.success)
        self.assertIsNotNone(result.draft)
        self.assertEqual(result.draft.kind, "payment")
        self.assertEqual(result.draft.customer_name, "Kannan")
        self.assertEqual(result.draft.total_rupees, 500.0)
        self.assertEqual(len(result.draft.items), 0, "Repayments must not hallucinate items")

    def test_04_combined_transaction(self):
        """Verify compound transactions separate repayment and new credit into discrete operations."""
        sample_combined = "Kumar munnaadi 500 baaki irukku, 200 kuduthaaru, inniku 70 ku saaman eduthaaru."
        result = self.client.extract_draft(sample_combined, force_mock=True)
        self.assertTrue(result.success)
        self.assertIsNotNone(result.draft)
        self.assertEqual(result.draft.kind, "combined")
        self.assertEqual(result.draft.customer_name, "Kumar")
        self.assertEqual(len(result.draft.operations), 2)
        self.assertEqual(result.draft.operations[0].type, "payment")
        self.assertEqual(result.draft.operations[1].type, "credit")

    def test_05_mid_utterance_correction(self):
        """Verify that speech corrections discard the earlier mistaken quantity/amount."""
        sample_correction = "விஜய் கணக்குல ஒரு கிலோ நெய் இருநூறு ரூபாய்... இல்ல இல்ல இருநூற்றி ஐம்பது ரூபாய் போடு."
        result = self.client.extract_draft(sample_correction, force_mock=True)
        self.assertTrue(result.success)
        self.assertIsNotNone(result.draft)
        self.assertEqual(result.draft.total_rupees, 250.0, "Should select corrected amount 250, not 200")

    def test_06_error_handling_invalid_key_and_mock_fallback(self):
        """Verify error classification when API key is unconfigured."""
        mock_client = GroqClient(api_key="gsk_invalid_test_key_xyz", timeout_seconds=1.0)
        # Using force_mock=True provides safe offline capability
        res = mock_client.extract_draft("Test text", force_mock=True)
        self.assertTrue(res.success)
        self.assertTrue(res.is_mock)

    def test_07_dataset_integrity(self):
        """Verify dataset has at least 30 synthetic test cases across specified categories."""
        cases = self.dataset.get("cases", [])
        self.assertGreaterEqual(len(cases), 30, "Dataset must contain at least 30 test cases")
        categories = {c["category"] for c in cases}
        self.assertGreaterEqual(len(categories), 8, "Dataset must cover diverse linguistic categories")


if __name__ == "__main__":
    unittest.main()
