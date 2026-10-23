// Centralized API helper
async function call(path, options) {
  const res = await fetch('/api' + path, options);
  const data = await res.json().catch(() => ( {} ));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const json = (method, body, headers = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body)
});

export const api = {
  // Customer CRUD
  customers: () => call('/customers'),
  addCustomer: (c) => call('/customers', json('POST', c)),
  updateCustomer: (id, data) => call(`/customers/${id}`, json('PUT', data)),
  deleteCustomer: (id) => call(`/customers/${id}`, { method: 'DELETE' }),

  // Archived handling
  listArchived: () => call('/customers/archived/list'),
  restoreCustomer: (id) => call(`/customers/${id}/restore`, { method: 'PUT' }),

  // Ledger & drafts
  ledger: (id) => call(`/customers/${id}/ledger`),
  draftFromText: (text, signal) => call('/draft/text', { ...json('POST', { text }), signal }),
  draftFromAudio: (wavBlob, signal) => {
    const form = new FormData();
    form.append('audio', wavBlob, 'clip.wav');
    return call('/draft/audio', { method: 'POST', body: form, signal });
  },

  // Confirm and reverse ledger entries
  confirm: (entry, key) => call('/ledger', json('POST', entry, { 'Idempotency-Key': key })),
  reverse: (id, reason) => call(`/ledger/${id}/reverse`, json('POST', { reason })),

  // WhatsApp message generation (proxy to AI service)
  generateWhatsAppMessage: (customerId, language = 'english') =>
    call(`/customers/${customerId}/whatsapp-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language })
    })
};

export const rupees = (paise) => '\u20B9' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 });
