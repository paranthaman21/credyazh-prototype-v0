import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:4000/api';

test('Segment 6: Gemini Latency Optimization & Multi-Model Telemetry', async () => {
  // Test AI service health endpoint
  const healthRes = await fetch('http://localhost:8000/health');
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.ok, true);
  assert.ok(health.primary_model, 'Must have a primary model configured');
  assert.ok(Array.isArray(health.configured_models), 'Must have configured_models array');
  assert.ok(health.configured_models.length >= 2, 'Must have primary and fallback models configured');

  // Test draft generation with Server-Timing header & metrics payload
  const draftRes = await fetch(`${BASE}/draft/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Barath 2 kg sakkarai 120 rupees' })
  });
  assert.equal(draftRes.status, 200);

  // Verify Server-Timing header
  const timingHeader = draftRes.headers.get('Server-Timing');
  assert.ok(timingHeader, 'Must return Server-Timing HTTP header');
  assert.match(timingHeader, /total;dur=\d+/, 'Must include total duration');
  assert.match(timingHeader, /ai;dur=\d+/, 'Must include AI duration');
  assert.match(timingHeader, /db;dur=\d+/, 'Must include DB duration');

  // Verify JSON metrics
  const data = await draftRes.json();
  assert.ok(data.metrics, 'Must return metrics object');
  assert.ok(data.metrics.geminiModel, 'Must report geminiModel');
  assert.ok(typeof data.metrics.geminiLatencyMs === 'number', 'Must report geminiLatencyMs');
  assert.ok(typeof data.metrics.aiTotalLatencyMs === 'number', 'Must report aiTotalLatencyMs');
  assert.ok(typeof data.metrics.dbLatencyMs === 'number', 'Must report dbLatencyMs');
  assert.ok(typeof data.metrics.serverTotalMs === 'number', 'Must report serverTotalMs');
  assert.ok(Array.isArray(data.metrics.modelsAttempted), 'Must report modelsAttempted list');
  assert.ok(data.metrics.modelsAttempted.length >= 1, 'Must record at least one model attempt');
  assert.equal(data.metrics.modelsAttempted[0].status, 'ok');

  // Verify financial correctness is preserved
  assert.equal(data.draft.kind, 'credit');
  assert.equal(data.draft.customerName, 'Barath');
  assert.equal(data.draft.totalPaise, 12000);
});
