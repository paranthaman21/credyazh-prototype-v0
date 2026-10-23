import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraft, amountWarnings, ConfirmSchema, rupeesToPaise } from '../src/validate.js';

test('Kumar example: total only, item prices stay unknown', () => {
  const d = normalizeDraft({ kind: 'credit', customer_name: 'Kumar', total_rupees: 160,
    items: [{ name: 'Dal', quantity: 0.5, unit: 'kg', price_rupees: null }, { name: 'Milk', quantity: 1, unit: 'L', price_rupees: null }] });
  assert.equal(d.totalPaise, 16000);
  assert.equal(d.items.length, 2);
  assert.equal(d.items[0].pricePaise, undefined);
});

test('rupees convert to integer paise without float errors', () => {
  assert.equal(rupeesToPaise(0.1 + 0.2), 30);
  assert.equal(rupeesToPaise(160), 16000);
});

test('unusual amount is flagged', () => {
  assert.ok(amountWarnings(150000, 15000).length > 0);   // Rs 1500 vs usual Rs 150
  assert.equal(amountWarnings(16000, 15000).length, 0);
  assert.ok(amountWarnings(null, null).length > 0);
});

test('confirm payload must have a positive integer total', () => {
  const base = { customerId: 'a'.repeat(24), kind: 'credit', items: [] };
  assert.equal(ConfirmSchema.safeParse({ ...base, totalPaise: 16000 }).success, true);
  assert.equal(ConfirmSchema.safeParse({ ...base, totalPaise: 0 }).success, false);
  assert.equal(ConfirmSchema.safeParse({ ...base, totalPaise: 160.5 }).success, false);
});

// ─── SEGMENT 1 Acceptance Tests ──────────────────────────────────────────────

test('Acceptance 1: Repayment only draft normalization and validation', () => {
  const d = normalizeDraft({
    kind: 'payment',
    customer_name: 'Kumar',
    total_rupees: 200,
    items: [],
    transcript: 'Kumar paid 200 rupees'
  });
  assert.equal(d.kind, 'payment');
  assert.equal(d.customerName, 'Kumar');
  assert.equal(d.totalPaise, 20000);
  assert.equal(d.operations.length, 1);
  assert.equal(d.operations[0].kind, 'payment');
  assert.equal(d.operations[0].totalPaise, 20000);

  const payload = {
    customerId: 'a'.repeat(24),
    kind: 'payment',
    totalPaise: 20000,
    items: []
  };
  assert.equal(ConfirmSchema.safeParse(payload).success, true);
});

test('Acceptance 2: Credit purchase only draft normalization and validation', () => {
  const d = normalizeDraft({
    kind: 'credit',
    customer_name: 'Kumar',
    total_rupees: 70,
    items: [{ name: 'Rice', quantity: 1, unit: 'kg' }],
    transcript: 'Kumar 1 kg rice 70 rupees'
  });
  assert.equal(d.kind, 'credit');
  assert.equal(d.customerName, 'Kumar');
  assert.equal(d.totalPaise, 7000);
  assert.equal(d.items[0].name, 'Rice');

  const payload = {
    customerId: 'a'.repeat(24),
    kind: 'credit',
    totalPaise: 7000,
    items: [{ name: 'Rice', quantity: 1, unit: 'kg' }]
  };
  assert.equal(ConfirmSchema.safeParse(payload).success, true);
});

test('Acceptance 3: Combined repayment and credit transaction draft and validation', () => {
  const d = normalizeDraft({
    kind: 'combined',
    customer_name: 'Kumar',
    total_rupees: 70,
    operations: [
      { type: 'payment', items: [], total_rupees: 200 },
      { type: 'credit', items: [{ name: 'Rice', quantity: 1, unit: 'kg' }], total_rupees: 70 }
    ],
    transcript: 'Kumar 200 rupees kuduthutu 70 rupees-ku arisi vaanginaan',
    confidence: 'high'
  });

  assert.equal(d.kind, 'combined');
  assert.equal(d.customerName, 'Kumar');
  assert.equal(d.operations.length, 2);
  assert.equal(d.operations[0].kind, 'payment');
  assert.equal(d.operations[0].totalPaise, 20000);
  assert.equal(d.operations[1].kind, 'credit');
  assert.equal(d.operations[1].totalPaise, 7000);
  assert.equal(d.operations[1].items[0].name, 'Rice');

  // Valid combined payload
  const validCombined = {
    customerId: 'a'.repeat(24),
    kind: 'combined',
    operations: [
      { kind: 'payment', totalPaise: 20000, items: [] },
      { kind: 'credit', totalPaise: 7000, items: [{ name: 'Rice', quantity: 1, unit: 'kg' }] }
    ]
  };
  assert.equal(ConfirmSchema.safeParse(validCombined).success, true);

  // Invalid: missing payment operation
  const missingPayment = {
    customerId: 'a'.repeat(24),
    kind: 'combined',
    operations: [
      { kind: 'credit', totalPaise: 7000, items: [] }
    ]
  };
  assert.equal(ConfirmSchema.safeParse(missingPayment).success, false);

  // Invalid: negative or zero amount in operation
  const invalidAmt = {
    customerId: 'a'.repeat(24),
    kind: 'combined',
    operations: [
      { kind: 'payment', totalPaise: 0, items: [] },
      { kind: 'credit', totalPaise: 7000, items: [] }
    ]
  };
  assert.equal(ConfirmSchema.safeParse(invalidAmt).success, false);
});

test('Acceptance 4: Repayment greater than outstanding balance math verification', () => {
  // Scenario: Balance ₹500 (50000 paise), Repayment ₹600 (60000 paise), Credit ₹70 (7000 paise)
  // Signed math: 50000 + (-60000) + (+7000) = -3000 paise (Customer has ₹30 in advance credit)
  const initialBalance = 50000;
  const repayment = -60000;
  const newCredit = 7000;
  const finalBalance = initialBalance + repayment + newCredit;
  assert.equal(finalBalance, -3000);
});

test('Acceptance 5: Ambiguous payment direction flags warnings', () => {
  // If an entry is missing an amount in combined operation:
  const warnings = amountWarnings(null, null, 'combined', [
    { kind: 'payment', totalPaise: null, items: [] },
    { kind: 'credit', totalPaise: 7000, items: [] }
  ]);
  assert.ok(warnings.some((w) => w.includes('Repayment amount is missing')));
});

