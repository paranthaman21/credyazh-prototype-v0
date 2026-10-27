const rawAiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
const AI_URL = rawAiUrl.replace(/\/+$/, '');

// Conservative wall-clock limit for the full fallback chain (2 models × 10 s each + overhead).
// The Python AI service already enforces a per-model timeout; this is a safety net on the
// Node side so Express never hangs indefinitely if the Python process stalls.
const AI_TIMEOUT_MS = Number(process.env.AI_CLIENT_TIMEOUT_MS) || 25000;

async function check(r) {
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).detail; } catch { /* ignore */ }
    const err = new Error(detail || `AI service error ${r.status}`);
    err.status = 502;
    throw err;
  }
  return r.json();
}

export async function draftFromAudio(buffer, mimetype) {
  const audio_base64 = Buffer.from(buffer).toString('base64');
  return check(await fetch(`${AI_URL}/draft/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_base64,
      mime_type: mimetype || 'audio/wav'
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
  }));
}

export async function draftFromText(text) {
  return check(await fetch(`${AI_URL}/draft/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
  }));
}
