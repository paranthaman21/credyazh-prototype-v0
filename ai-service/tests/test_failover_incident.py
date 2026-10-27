import os
import json
import unittest
from unittest.mock import MagicMock, patch
from failover_orchestrator import FailoverOrchestrator, DraftResponse, Draft

class TestFailoverIncidentFullMatrix(unittest.TestCase):
    def setUp(self):
        os.environ["GEMINI_API_KEY"] = "mock_gemini_key_for_testing"
        os.environ["GROQ_API_KEY"] = "gsk_mock_groq_key_for_testing"
        self.orchestrator = FailoverOrchestrator(
            gemini_models=["gemini-3.5-flash-lite"],
            groq_model="llama-3.3-70b-versatile",
            shared_deadline_ms=8000,
            failover_enabled=True,
            enable_local_extractor=False,
        )

    def test_case_1_gemini_success(self):
        """Case 1: Gemini success -> Valid draft, no Groq attempt."""
        mock_gemini_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.text = json.dumps({
            "kind": "credit",
            "customer_name": "Karthik",
            "items": [{"name": "Sugar", "quantity": 1.0, "unit": "kg", "price_rupees": 45.0}],
            "total_rupees": 45.0,
            "operations": [],
            "transcript": "Karthik sugar 1kg 45",
            "confidence": "high"
        })
        mock_gemini_client.models.generate_content.return_value = mock_resp

        with patch("google.genai.Client", return_value=mock_gemini_client), \
             patch("httpx.Client") as mock_httpx:
            resp = self.orchestrator.extract_text("Karthik sugar 1kg 45")
            self.assertEqual(resp.customer_name, "Karthik")
            self.assertEqual(resp.total_rupees, 45.0)
            self.assertFalse(resp.metrics.get("failover_triggered", False))
            self.assertEqual(len(resp.metrics.get("models_attempted", [])), 1)
            self.assertEqual(resp.metrics.get("models_attempted")[0]["provider"], "gemini")
            mock_httpx.assert_not_called()

    def test_case_2_forced_gemini_503_groq_success(self):
        """Case 2: Forced Gemini 503 + Groq success -> Valid Groq draft, failover indicator true."""
        mock_gemini_client = MagicMock()
        mock_gemini_client.models.generate_content.side_effect = Exception("503 Service Unavailable: The model is overloaded")

        groq_valid_payload = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "kind": "credit",
                        "customer_name": "Murugan",
                        "items": [{"name": "Rice", "quantity": 5.0, "unit": "kg", "price_rupees": 250.0}],
                        "total_rupees": 250.0,
                        "operations": [],
                        "transcript": "Murugan 5kg rice 250 rupees credit",
                        "confidence": "high"
                    })
                }
            }]
        }

        mock_http_resp = MagicMock()
        mock_http_resp.status_code = 200
        mock_http_resp.json.return_value = groq_valid_payload

        with patch("google.genai.Client", return_value=mock_gemini_client), \
             patch("httpx.Client") as mock_httpx_class:
            mock_client_instance = MagicMock()
            mock_client_instance.__enter__.return_value = mock_client_instance
            mock_client_instance.post.return_value = mock_http_resp
            mock_httpx_class.return_value = mock_client_instance

            resp = self.orchestrator.extract_text("Murugan 5kg rice 250 rupees credit")

            self.assertEqual(resp.customer_name, "Murugan")
            self.assertEqual(resp.total_rupees, 250.0)
            self.assertTrue(resp.metrics.get("failover_triggered"))
            self.assertEqual(resp.metrics.get("provider"), "groq")
            self.assertNotEqual(resp.metrics.get("model"), "manual_fallback")

            attempts = resp.metrics.get("models_attempted", [])
            self.assertEqual(len(attempts), 2)
            self.assertEqual(attempts[0]["provider"], "gemini")
            self.assertTrue("503" in str(attempts[0]["error"]) or "503" in str(attempts[0]["status"]))
            self.assertEqual(attempts[1]["provider"], "groq")
            self.assertEqual(attempts[1]["status"], "ok")
            self.assertIn("Gemini: 503 → Groq: 200", resp.metrics.get("failover_trace", ""))

    def test_case_3_gemini_timeout_groq_success(self):
        """Case 3: Gemini timeout + Groq success -> Valid Groq draft if budget permits."""
        mock_gemini_client = MagicMock()
        mock_gemini_client.models.generate_content.side_effect = Exception("504 Gateway Timeout: deadline exceeded")

        groq_valid_payload = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "kind": "payment",
                        "customer_name": "Anbu",
                        "items": [],
                        "total_rupees": 500.0,
                        "operations": [],
                        "transcript": "Anbu paid 500",
                        "confidence": "high"
                    })
                }
            }]
        }

        mock_http_resp = MagicMock()
        mock_http_resp.status_code = 200
        mock_http_resp.json.return_value = groq_valid_payload

        with patch("google.genai.Client", return_value=mock_gemini_client), \
             patch("httpx.Client") as mock_httpx_class:
            mock_client_instance = MagicMock()
            mock_client_instance.__enter__.return_value = mock_client_instance
            mock_client_instance.post.return_value = mock_http_resp
            mock_httpx_class.return_value = mock_client_instance

            resp = self.orchestrator.extract_text("Anbu paid 500")
            self.assertEqual(resp.customer_name, "Anbu")
            self.assertEqual(resp.total_rupees, 500.0)
            self.assertTrue(resp.metrics.get("failover_triggered"))
            self.assertEqual(resp.metrics.get("provider"), "groq")
            self.assertIn("timeout", resp.metrics.get("failover_trace", ""))

    def test_case_4_both_providers_fail(self):
        """Case 4: Both providers fail -> Manual fallback."""
        mock_gemini_client = MagicMock()
        mock_gemini_client.models.generate_content.side_effect = Exception("503 Service Unavailable")

        mock_http_resp = MagicMock()
        mock_http_resp.status_code = 503
        mock_http_resp.text = "Groq capacity exceeded"

        with patch("google.genai.Client", return_value=mock_gemini_client), \
             patch("httpx.Client") as mock_httpx_class:
            mock_client_instance = MagicMock()
            mock_client_instance.__enter__.return_value = mock_client_instance
            mock_client_instance.post.return_value = mock_http_resp
            mock_httpx_class.return_value = mock_client_instance

            resp = self.orchestrator.extract_text("Ramesh 100 rupees payment")

            self.assertEqual(resp.confidence, "low")
            self.assertEqual(resp.metrics.get("provider"), "manual_fallback")
            self.assertEqual(resp.metrics.get("manual_fallback_reason"), "BOTH_PROVIDERS_UNAVAILABLE")
            attempts = resp.metrics.get("models_attempted", [])
            self.assertEqual(len(attempts), 2)
            self.assertEqual(attempts[0]["provider"], "gemini")
            self.assertEqual(attempts[1]["provider"], "groq")
            self.assertIn("Manual fallback", resp.metrics.get("failover_trace", ""))

    def test_case_5_groq_malformed_json_recovery(self):
        """Case 5: Groq returns malformed JSON -> Safe validation/recovery behavior."""
        mock_gemini_client = MagicMock()
        mock_gemini_client.models.generate_content.side_effect = Exception("503 Service Unavailable")

        mock_http_resp = MagicMock()
        mock_http_resp.status_code = 200
        mock_http_resp.json.return_value = {
            "choices": [{
                "message": {
                    "content": "Invalid payload: {name: broken_json...}"
                }
            }]
        }

        with patch("google.genai.Client", return_value=mock_gemini_client), \
             patch("httpx.Client") as mock_httpx_class:
            mock_client_instance = MagicMock()
            mock_client_instance.__enter__.return_value = mock_client_instance
            mock_client_instance.post.return_value = mock_http_resp
            mock_httpx_class.return_value = mock_client_instance

            resp = self.orchestrator.extract_text("Sundar 200 rupees credit")
            # Should safely degrade to manual fallback without 500 crash
            self.assertEqual(resp.confidence, "low")
            self.assertEqual(resp.metrics.get("provider"), "manual_fallback")
            self.assertIn("Manual fallback", resp.metrics.get("failover_trace", ""))

    def test_case_6_frontend_receives_valid_groq_result_fields(self):
        """Case 6: Frontend receives valid Groq result -> Valid draft fields present."""
        mock_gemini_client = MagicMock()
        mock_gemini_client.models.generate_content.side_effect = Exception("503 Service Unavailable")

        groq_valid_payload = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "kind": "credit",
                        "customer_name": "Kavitha",
                        "items": [{"name": "Milk", "quantity": 1.0, "unit": "litre", "price_rupees": 30.0}],
                        "total_rupees": 30.0,
                        "operations": [{"type": "credit", "items": [{"name": "Milk", "quantity": 1.0, "unit": "litre", "price_rupees": 30.0}], "total_rupees": 30.0}],
                        "transcript": "Kavitha paal 1 litre 30 rooba",
                        "confidence": "high"
                    })
                }
            }]
        }

        mock_http_resp = MagicMock()
        mock_http_resp.status_code = 200
        mock_http_resp.json.return_value = groq_valid_payload

        with patch("google.genai.Client", return_value=mock_gemini_client), \
             patch("httpx.Client") as mock_httpx_class:
            mock_client_instance = MagicMock()
            mock_client_instance.__enter__.return_value = mock_client_instance
            mock_client_instance.post.return_value = mock_http_resp
            mock_httpx_class.return_value = mock_client_instance

            resp = self.orchestrator.extract_text("Kavitha paal 1 litre 30 rooba")
            dump = resp.model_dump()
            self.assertEqual(dump["customer_name"], "Kavitha")
            self.assertEqual(dump["total_rupees"], 30.0)
            self.assertEqual(len(dump["items"]), 1)
            self.assertEqual(dump["confidence"], "high")
            self.assertFalse(dump["metrics"]["provider"] == "manual_fallback")

    def test_case_7_failover_attempt_counter_reflects_actual_attempts(self):
        """Case 7: Failover attempt counter reflects actual provider attempts."""
        # Single attempt case
        mock_gemini_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.text = json.dumps({
            "kind": "credit",
            "customer_name": "Mani",
            "items": [],
            "total_rupees": 100.0,
            "operations": [],
            "transcript": "Mani 100",
            "confidence": "high"
        })
        mock_gemini_client.models.generate_content.return_value = mock_resp

        with patch("google.genai.Client", return_value=mock_gemini_client):
            resp1 = self.orchestrator.extract_text("Mani 100")
            attempts1 = resp1.metrics.get("models_attempted", [])
            self.assertEqual(len(attempts1), 1)

        # Multi-attempt failover case
        mock_gemini_client.models.generate_content.side_effect = Exception("503 Service Unavailable")
        groq_valid_payload = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "kind": "credit",
                        "customer_name": "Mani",
                        "items": [],
                        "total_rupees": 100.0,
                        "operations": [],
                        "transcript": "Mani 100",
                        "confidence": "high"
                    })
                }
            }]
        }
        mock_http_resp = MagicMock()
        mock_http_resp.status_code = 200
        mock_http_resp.json.return_value = groq_valid_payload

        with patch("google.genai.Client", return_value=mock_gemini_client), \
             patch("httpx.Client") as mock_httpx_class:
            mock_client_instance = MagicMock()
            mock_client_instance.__enter__.return_value = mock_client_instance
            mock_client_instance.post.return_value = mock_http_resp
            mock_httpx_class.return_value = mock_client_instance

            resp2 = self.orchestrator.extract_text("Mani 100")
            attempts2 = resp2.metrics.get("models_attempted", [])
            self.assertEqual(len(attempts2), 2)
            self.assertEqual(attempts2[0]["provider"], "gemini")
            self.assertEqual(attempts2[1]["provider"], "groq")

if __name__ == "__main__":
    unittest.main()
