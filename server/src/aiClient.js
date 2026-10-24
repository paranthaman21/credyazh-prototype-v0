const rawAiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
const AI_URL = rawAiUrl.replace(/\/+$/, '');

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
    })
  }));
}

export async function draftFromText(text) {
  return check(await fetch(`${AI_URL}/draft/text`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
  }));
}
