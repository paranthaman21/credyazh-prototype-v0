// Telemetry tracking for AI extraction latency (p50, p95)
const STORAGE_KEY = 'credyazh_latency_samples_v1';
const MAX_SAMPLES = 50;

function loadSamples() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSamples(samples) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)));
  } catch {
    // ignore
  }
}

export function recordLatency(sample) {
  if (!sample || typeof sample.totalMs !== 'number') return;
  const samples = loadSamples();
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    timestamp: Date.now(),
    type: sample.type || 'audio',
    model: sample.model || 'unknown',
    totalMs: Math.round(sample.totalMs),
    geminiMs: Math.round(sample.geminiMs || 0),
    serverMs: Math.round(sample.serverMs || 0),
    encodingMs: Math.round(sample.encodingMs || 0)
  };
  samples.push(entry);
  saveSamples(samples);

  console.info(
    `[CredYazh Telemetry] Extracted via ${entry.model} in ${entry.totalMs}ms ` +
    `(Gemini: ${entry.geminiMs}ms | Server: ${entry.serverMs}ms | Encoding: ${entry.encodingMs}ms)`
  );
  return entry;
}

export function getLatencyStats() {
  const samples = loadSamples();
  if (samples.length === 0) {
    return { count: 0, p50: null, p95: null, avg: null, min: null, max: null, last: null };
  }

  const totals = samples.map((s) => s.totalMs).sort((a, b) => a - b);
  const count = totals.length;
  const p50 = totals[Math.floor(count * 0.5)];
  const p95 = totals[Math.min(count - 1, Math.floor(count * 0.95))];
  const min = totals[0];
  const max = totals[count - 1];
  const avg = Math.round(totals.reduce((sum, v) => sum + v, 0) / count);

  return {
    count,
    p50,
    p95,
    min,
    max,
    avg,
    last: samples[samples.length - 1]
  };
}
