import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:4000/api';

test('Live API: Combined Credit & Repayment End-to-End Flow', async (t) => {
  // 1. Create temporary customer
  const custRes = await fetch(`${BASE}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `TestKumar_${Date.now()}` })
  });
  assert.equal(custRes.status, 201);
  const customer = await custRes.json();
  const customerId = customer._id;

  // 2. Add initial outstanding balance of ₹500 (50,000 paise)
  const initialKey = `init_${Date.now()}_${Math.random()}`;
  const initRes = await fetch(`${BASE}/ledger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': initialKey
    },
    body: JSON.stringify({
      customerId,
      kind: 'credit',
      totalPaise: 50000,
      items: [{ name: 'Initial Groceries', quantity: 1, unit: 'bag' }]
    })
  });
  assert.equal(initRes.status, 201);

  // Verify initial balance is 50,000 paise (₹500)
  const ledger1 = await (await fetch(`${BASE}/customers/${customerId}/ledger`)).json();
  assert.equal(ledger1.balancePaise, 50000);

  // 3. Post combined transaction: Repayment ₹200 (20,000 paise) + New Credit ₹70 (7,000 paise)
  const combinedKey = `comb_${Date.now()}_${Math.random()}`;
  const combRes = await fetch(`${BASE}/ledger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': combinedKey
    },
    body: JSON.stringify({
      customerId,
      kind: 'combined',
      operations: [
        { kind: 'payment', totalPaise: 20000, items: [] },
        { kind: 'credit', totalPaise: 7000, items: [{ name: 'Rice', quantity: 1, unit: 'kg' }] }
      ],
      source: 'voice',
      transcript: 'Kumar 200 rupees kuduthutu, 70 rupees-ku arisi vaanginaan'
    })
  });
  assert.equal(combRes.status, 201);
  const combData = await combRes.json();
  assert.equal(combData.duplicate, false);
  assert.equal(combData.events.length, 2);

  // Verify grouped events and audit link
  const payEvent = combData.events.find((e) => e.type === 'PAYMENT');
  const credEvent = combData.events.find((e) => e.type === 'CREDIT');
  assert.ok(payEvent, 'Payment event must exist');
  assert.ok(credEvent, 'Credit event must exist');
  assert.equal(payEvent.signedAmountPaise, -20000);
  assert.equal(credEvent.signedAmountPaise, 7000);
  assert.equal(payEvent.groupId, combinedKey);
  assert.equal(credEvent.groupId, combinedKey);

  // 4. Acceptance 6: Duplicate submission test
  const dupRes = await fetch(`${BASE}/ledger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': combinedKey
    },
    body: JSON.stringify({
      customerId,
      kind: 'combined',
      operations: [
        { kind: 'payment', totalPaise: 20000, items: [] },
        { kind: 'credit', totalPaise: 7000, items: [{ name: 'Rice', quantity: 1, unit: 'kg' }] }
      ]
    })
  });
  assert.equal(dupRes.status, 200);
  const dupData = await dupRes.json();
  assert.equal(dupData.duplicate, true);
  assert.equal(dupData.events.length, 2);

  // 5. Acceptance 8: Correct final balance (500 - 200 + 70 = 370)
  // 50,000 - 20,000 + 7,000 = 37,000 paise (₹370)
  const ledger2 = await (await fetch(`${BASE}/customers/${customerId}/ledger`)).json();
  assert.equal(ledger2.balancePaise, 37000, 'Final balance must be exactly 37,000 paise (₹370)');

  // Verify total events count for this customer: 1 initial + 2 combined = 3 events
  assert.equal(ledger2.events.length, 3);

  // 6. Acceptance 7: Prevent partial posting if any part fails
  const invalidKey = `fail_${Date.now()}_${Math.random()}`;
  const failRes = await fetch(`${BASE}/ledger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': invalidKey
    },
    body: JSON.stringify({
      customerId,
      kind: 'combined',
      operations: [
        { kind: 'payment', totalPaise: 10000, items: [] },
        { kind: 'credit', totalPaise: -500, items: [] } // Invalid negative total
      ]
    })
  });
  assert.equal(failRes.status, 400, 'Should reject invalid combined payload with 400');

  // Verify ledger is unchanged (still 3 events and 37,000 paise balance)
  const ledgerAfterFail = await (await fetch(`${BASE}/customers/${customerId}/ledger`)).json();
  assert.equal(ledgerAfterFail.balancePaise, 37000, 'Balance must remain unchanged after rejected transaction');
  assert.equal(ledgerAfterFail.events.length, 3, 'No partial events should be posted');
});
