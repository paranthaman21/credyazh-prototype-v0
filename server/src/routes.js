import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { Customer, LedgerEvent, SHOP_ID } from './models.js';
import { CustomerSchema, ConfirmSchema, ReverseSchema, normalizeDraft, amountWarnings } from './validate.js';
import { draftFromAudio, draftFromText } from './aiClient.js';

export const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const bad = (res, err) => res.status(400).json({ error: err.issues ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err.message || err) });
const isObjectId = (id) => mongoose.isValidObjectId(id);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Balance of a customer = sum of all their ledger events (never stored, always derived).
async function balances() {
  const rows = await LedgerEvent.aggregate([
    { $match: { shopId: SHOP_ID } },
    { $group: { _id: '$customerId', balancePaise: { $sum: '$signedAmountPaise' } } }
  ]);
  return new Map(rows.map((r) => [String(r._id), r.balancePaise]));
}

// ---------- Customers ----------
router.get('/customers', async (_req, res) => {
  const [customers, bal] = await Promise.all([
    Customer.find({ shopId: SHOP_ID, archived: { $ne: true } }).sort({ name: 1 }).lean(),
    balances()
  ]);
  res.json(customers.map((c) => ({ ...c, balancePaise: bal.get(String(c._id)) || 0 })));
});

router.post('/customers', async (req, res) => {
  const p = CustomerSchema.safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const c = await Customer.create({ ...p.data, shopId: SHOP_ID });
  res.status(201).json({ ...c.toObject(), balancePaise: 0 });
});

router.put('/customers/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'invalid customer id' });
  const p = CustomerSchema.safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const c = await Customer.findOneAndUpdate(
    { _id: req.params.id, shopId: SHOP_ID },
    { $set: { name: p.data.name, phone: p.data.phone || undefined } },
    { new: true }
  ).lean();
  if (!c) return res.status(404).json({ error: 'customer not found' });
  const bal = (await balances()).get(String(c._id)) || 0;
  res.json({ ...c, balancePaise: bal });
});

router.delete('/customers/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'invalid customer id' });
  const bal = (await balances()).get(req.params.id) || 0;
  if (bal !== 0) {
    const amtStr = bal > 0 ? `Rs ${(bal / 100).toFixed(2)}` : `-Rs ${(-bal / 100).toFixed(2)}`;
    return res.status(400).json({
      error: `Cannot delete customer with active balance of ${amtStr}. Please settle the balance first.`
    });
  }
  const c = await Customer.findOneAndUpdate(
    { _id: req.params.id, shopId: SHOP_ID },
    { $set: { archived: true } },
    { new: true }
  ).lean();
  if (!c) return res.status(404).json({ error: 'customer not found' });
  res.json({ ok: true, archived: true, id: req.params.id });
});

router.get('/customers/:id/ledger', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'invalid customer id' });
  const [customer, events] = await Promise.all([
    Customer.findOne({ _id: req.params.id, shopId: SHOP_ID }).lean(),
    LedgerEvent.find({ shopId: SHOP_ID, customerId: req.params.id }).sort({ createdAt: -1 }).lean()
  ]);
  if (!customer) return res.status(404).json({ error: 'customer not found' });

  const reversed = new Set(events.filter((e) => e.type === 'REVERSAL').map((e) => String(e.reversesEventId)));
  const activeEvents = events.filter((e) => !reversed.has(String(e._id)) && e.type !== 'REVERSAL');
  const totalCreditPaise = activeEvents.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.signedAmountPaise, 0);
  const totalPaymentPaise = activeEvents.filter((e) => e.type === 'PAYMENT').reduce((s, e) => s + Math.abs(e.signedAmountPaise), 0);
  const balancePaise = events.reduce((s, e) => s + e.signedAmountPaise, 0);

  res.json({
    customer,
    balancePaise,
    totalCreditPaise,
    totalPaymentPaise,
    events: events.map((e) => ({ ...e, isReversed: reversed.has(String(e._id)) }))
  });
});

// ---------- Archived customers ----------
router.get('/customers/archived/list', async (_req, res) => {
  const [customers, bal] = await Promise.all([
    Customer.find({ shopId: SHOP_ID, archived: true }).sort({ name: 1 }).lean(),
    balances()
  ]);
  res.json(customers.map((c) => ({ ...c, balancePaise: bal.get(String(c._id)) || 0 })));
});

router.put('/customers/:id/restore', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'invalid customer id' });
  const c = await Customer.findOneAndUpdate(
    { _id: req.params.id, shopId: SHOP_ID, archived: true },
    { $set: { archived: false } },
    { new: true }
  ).lean();
  if (!c) return res.status(404).json({ error: 'customer not found or not archived' });
  const bal = (await balances()).get(String(c._id)) || 0;
  res.json({ ...c, balancePaise: bal });
});

// ---------- WhatsApp message generation (proxy to AI service) ----------
const SHOP_NAME = process.env.SHOP_NAME || 'Demo Kirana Shop';

router.post('/customers/:id/whatsapp-message', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'invalid customer id' });
  const language = req.body?.language || 'english';
  if (!['english', 'tamil', 'tanglish'].includes(language)) {
    return res.status(400).json({ error: 'language must be one of: english, tamil, tanglish' });
  }

  const [customer, events] = await Promise.all([
    Customer.findOne({ _id: req.params.id, shopId: SHOP_ID }).lean(),
    LedgerEvent.find({ shopId: SHOP_ID, customerId: req.params.id }).sort({ createdAt: -1 }).lean()
  ]);
  if (!customer) return res.status(404).json({ error: 'customer not found' });

  const reversed = new Set(events.filter((e) => e.type === 'REVERSAL').map((e) => String(e.reversesEventId)));
  const activeEvents = events.filter((e) => !reversed.has(String(e._id)) && e.type !== 'REVERSAL');
  const totalCreditPaise = activeEvents.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.signedAmountPaise, 0);
  const totalPaymentPaise = activeEvents.filter((e) => e.type === 'PAYMENT').reduce((s, e) => s + Math.abs(e.signedAmountPaise), 0);
  const balancePaise = events.reduce((s, e) => s + e.signedAmountPaise, 0);

  const recentTransactions = events
    .filter((e) => e.type !== 'REVERSAL' && !reversed.has(String(e._id)))
    .slice(0, 6)
    .map((e) => ({
      date: new Date(e.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      type: e.type === 'CREDIT' ? 'credit' : 'payment',
      description: e.items?.map((i) => i.name).join(', ') || (e.type === 'CREDIT' ? 'Credit purchase' : 'Cash payment'),
      amount_rupees: Math.abs(e.signedAmountPaise) / 100
    }));

  const AI_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
  try {
    const aiRes = await fetch(`${AI_URL}/whatsapp-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop_name: SHOP_NAME,
        customer_name: customer.name,
        balance_rupees: balancePaise / 100,
        total_credit_rupees: totalCreditPaise / 100,
        total_payment_rupees: totalPaymentPaise / 100,
        recent_transactions: recentTransactions,
        language
      })
    });
    if (!aiRes.ok) throw new Error(`AI service returned ${aiRes.status}`);
    const { message } = await aiRes.json();
    return res.json({ message, language, shopName: SHOP_NAME, customerPhone: customer.phone || null });
  } catch (err) {
    // Fallback: reliable template (zero AI fabrication)
    const balance = `₹${(Math.abs(balancePaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const credit = `₹${(totalCreditPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const payment = `₹${(totalPaymentPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    let message = '';
    if (language === 'tamil') {
      message = `வணக்கம் ${customer.name},\n\n${SHOP_NAME} இல் இருந்து உங்கள் கணக்கு விவரம்:\n\nநிலுவை தொகை: ${balance}\nமொத்த கடன்: ${credit}\nமொத்த திருப்பிச் செலுத்தியது: ${payment}\n\nஉங்கள் ஆதரவிற்கு நன்றி. ஏதேனும் வேறுபாடு இருந்தால் எங்களை தொடர்பு கொள்ளுங்கள்.\n\nநன்றி,\n${SHOP_NAME}`;
    } else if (language === 'tanglish') {
      message = `Vanakkam ${customer.name},\n\n${SHOP_NAME} irundhu ungal account pathi oru update:\n\nCurrent balance: ${balance}\nTotal credit: ${credit}\nTotal repayments: ${payment}\n\nUngal support-ku nandri. Enna thappu irundhaal, engalai contact pannungal.\n\nRegards,\n${SHOP_NAME}`;
    } else {
      message = `Hello ${customer.name},\n\nGreetings from ${SHOP_NAME}!\n\nAccount Update:\nOutstanding Balance: ${balance}\nTotal Credit: ${credit}\nTotal Repayments: ${payment}\n\nThank you for your support. Contact us for any discrepancy.\n\nRegards,\n${SHOP_NAME}`;
    }
    return res.json({ message, language, shopName: SHOP_NAME, customerPhone: customer.phone || null });
  }
});



// ---------- Drafts (AI proposes, nothing is saved here) ----------
async function buildDraftResponse(aiJson, extraMetrics = {}) {
  const tDb0 = Date.now();
  const draft = normalizeDraft(aiJson);
  let candidates = [];
  let avgCreditPaise = null;
  if (draft.customerName) {
    candidates = await Customer.find({ shopId: SHOP_ID, name: new RegExp(escapeRegex(draft.customerName), 'i') }).limit(5).lean();
    if (candidates.length === 1) {
      const credits = await LedgerEvent.find({ customerId: candidates[0]._id, type: 'CREDIT' }).limit(50).lean();
      if (credits.length) avgCreditPaise = credits.reduce((s, e) => s + e.signedAmountPaise, 0) / credits.length;
    }
  }
  const warnings = amountWarnings(draft.totalPaise, avgCreditPaise, draft.kind, draft.operations);
  if (!draft.customerName) warnings.push('No customer name was heard. Please choose the customer.');
  else if (candidates.length === 0) warnings.push(`No customer matches "${draft.customerName}". Choose one or add a new customer.`);
  else if (candidates.length > 1) warnings.push(`${candidates.length} customers match "${draft.customerName}". Please choose the right one.`);
  if (draft.confidence === 'low') warnings.push('The AI was not sure about this entry. Please check every field.');
  else if (draft.confidence === 'medium') warnings.push('The AI noted some uncertainty (e.g. payment direction or amounts). Please review.');

  const dbDurationMs = Date.now() - tDb0;
  const metrics = {
    geminiModel: aiJson.metrics?.model || 'unknown',
    geminiLatencyMs: aiJson.metrics?.gemini_latency_ms || 0,
    validationLatencyMs: aiJson.metrics?.validation_latency_ms || 0,
    aiTotalLatencyMs: aiJson.metrics?.ai_total_latency_ms || 0,
    modelsAttempted: aiJson.metrics?.models_attempted || [],
    dbLatencyMs: dbDurationMs,
    ...extraMetrics
  };

  return {
    draft,
    candidates: candidates.map((c) => ({ id: String(c._id), name: c.name })),
    warnings,
    metrics
  };
}

router.post('/draft/audio', upload.single('audio'), async (req, res) => {
  const t0 = Date.now();
  if (!req.file) return res.status(400).json({ error: 'audio file is required' });
  try {
    const tAi0 = Date.now();
    const aiJson = await draftFromAudio(req.file.buffer, req.file.mimetype);
    const aiCallMs = Date.now() - tAi0;
    const result = await buildDraftResponse(aiJson, {
      uploadBufferBytes: req.file.buffer.length,
      serverTotalMs: Date.now() - t0
    });
    result.metrics.serverTotalMs = Date.now() - t0;

    // Send Server-Timing header for transparent network/devtool inspection
    const timingParts = [
      `total;dur=${result.metrics.serverTotalMs}`,
      `ai;dur=${aiCallMs}`,
      `db;dur=${result.metrics.dbLatencyMs}`
    ];
    if (result.metrics.geminiLatencyMs) {
      timingParts.push(`gemini;dur=${result.metrics.geminiLatencyMs}`);
    }
    res.setHeader('Server-Timing', timingParts.join(', '));
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/draft/text', async (req, res) => {
  const t0 = Date.now();
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const tAi0 = Date.now();
    const aiJson = await draftFromText(text);
    const aiCallMs = Date.now() - tAi0;
    const result = await buildDraftResponse(aiJson, {
      serverTotalMs: Date.now() - t0
    });
    result.metrics.serverTotalMs = Date.now() - t0;

    const timingParts = [
      `total;dur=${result.metrics.serverTotalMs}`,
      `ai;dur=${aiCallMs}`,
      `db;dur=${result.metrics.dbLatencyMs}`
    ];
    if (result.metrics.geminiLatencyMs) {
      timingParts.push(`gemini;dur=${result.metrics.geminiLatencyMs}`);
    }
    res.setHeader('Server-Timing', timingParts.join(', '));
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- Ledger (only the merchant's confirmed entry is saved) ----------
router.post('/ledger', async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 100) return res.status(400).json({ error: 'Idempotency-Key header is required' });
  const p = ConfirmSchema.safeParse(req.body);
  if (!p.success) return bad(res, p.error);

  const existing = await LedgerEvent.find({
    shopId: SHOP_ID,
    $or: [{ idempotencyKey: key }, { groupId: key }]
  }).sort({ batchIndex: 1, createdAt: 1 }).lean();

  if (existing.length > 0) {
    return res.status(200).json({ events: existing, event: existing[0], duplicate: true });
  }

  const customer = await Customer.findOne({ _id: p.data.customerId, shopId: SHOP_ID }).lean();
  if (!customer) return res.status(404).json({ error: 'customer not found' });

  let docsToInsert = [];
  if (p.data.kind === 'combined') {
    docsToInsert = p.data.operations.map((op, idx) => ({
      shopId: SHOP_ID,
      customerId: customer._id,
      type: op.kind === 'credit' ? 'CREDIT' : 'PAYMENT',
      signedAmountPaise: op.kind === 'credit' ? op.totalPaise : -op.totalPaise,
      items: op.items || [],
      source: p.data.source,
      transcript: p.data.transcript,
      groupId: key,
      batchIndex: idx,
      idempotencyKey: `${key}:${op.kind}:${idx}`
    }));
  } else {
    docsToInsert = [{
      shopId: SHOP_ID,
      customerId: customer._id,
      type: p.data.kind === 'credit' ? 'CREDIT' : 'PAYMENT',
      signedAmountPaise: p.data.kind === 'credit' ? p.data.totalPaise : -p.data.totalPaise,
      items: p.data.items,
      source: p.data.source,
      transcript: p.data.transcript,
      groupId: key,
      batchIndex: 0,
      idempotencyKey: key
    }];
  }

  let session = null;
  let useTransaction = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    useTransaction = true;
  } catch {
    if (session) {
      await session.endSession().catch(() => {});
      session = null;
    }
  }

  try {
    let createdEvents = [];
    if (useTransaction && session) {
      try {
        createdEvents = await LedgerEvent.insertMany(docsToInsert, { session });
        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        throw err;
      }
    } else {
      const inserted = [];
      try {
        for (const doc of docsToInsert) {
          const ev = await LedgerEvent.create(doc);
          inserted.push(ev);
        }
        createdEvents = inserted;
      } catch (err) {
        if (inserted.length > 0) {
          const insertedIds = inserted.map((i) => i._id);
          await LedgerEvent.deleteMany({ _id: { $in: insertedIds } }).catch(() => {});
        }
        throw err;
      }
    }

    const eventObjects = createdEvents.map((e) => (e.toObject ? e.toObject() : e));
    return res.status(201).json({
      events: eventObjects,
      event: eventObjects[0],
      duplicate: false
    });
  } catch (e) {
    if (e.code === 11000) {
      const again = await LedgerEvent.find({
        shopId: SHOP_ID,
        $or: [{ idempotencyKey: key }, { groupId: key }]
      }).sort({ batchIndex: 1, createdAt: 1 }).lean();
      return res.status(200).json({ events: again, event: again[0], duplicate: true });
    }
    throw e;
  } finally {
    if (session) {
      await session.endSession().catch(() => {});
    }
  }
});

router.post('/ledger/:id/reverse', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'invalid event id' });
  const p = ReverseSchema.safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const original = await LedgerEvent.findOne({ _id: req.params.id, shopId: SHOP_ID }).lean();
  if (!original) return res.status(404).json({ error: 'event not found' });
  if (original.type === 'REVERSAL') return res.status(409).json({ error: 'a reversal cannot be reversed' });
  try {
    const event = await LedgerEvent.create({
      shopId: SHOP_ID,
      customerId: original.customerId,
      type: 'REVERSAL',
      signedAmountPaise: -original.signedAmountPaise,
      reversesEventId: original._id,
      reason: p.data.reason
    });
    res.status(201).json({ event: event.toObject() });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'this entry is already reversed' });
    throw e;
  }
});
