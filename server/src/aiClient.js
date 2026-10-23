const AI_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';

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
  const form = new FormData();
  form.append('audio', new Blob([buffer], { type: mimetype }), 'clip');
  return check(await fetch(`${AI_URL}/draft/audio`, { method: 'POST', body: form }));
}

export async function draftFromText(text) {
  return check(await fetch(`${AI_URL}/draft/text`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
  }));
}
