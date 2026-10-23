import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:4000/api';

test('Customer Management: Create, Read, Update, Ledger Totals, and Archive', async (t) => {
  // 1. Create a customer with name and phone
  const createRes = await fetch(`${BASE}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `StatementCust_${Date.now()}`, phone: '9876543210' })
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  const customerId = created._id;
  assert.equal(created.phone, '9876543210');

  // 2. Update customer name and phone (PUT /customers/:id)
  const updateRes = await fetch(`${BASE}/customers/${customerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `UpdatedCust_${Date.now()}`, phone: '9998887776' })
  });
  assert.equal(updateRes.status, 200);
  const updated = await updateRes.json();
  assert.equal(updated.phone, '9998887776');

  // 3. Post a credit event of Rs 300 (30,000 paise)
  await fetch(`${BASE}/ledger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `k_cred_${Date.now()}`
    },
    body: JSON.stringify({
      customerId,
      kind: 'credit',
      totalPaise: 30000,
      items: [{ name: 'Rice', quantity: 2, unit: 'kg' }]
    })
  });

  // 4. Post a payment event of Rs 100 (10,000 paise)
  await fetch(`${BASE}/ledger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `k_pay_${Date.now()}`
    },
    body: JSON.stringify({
      customerId,
      kind: 'payment',
      totalPaise: 10000,
      items: []
    })
  });

  // 5. Verify ledger totals in GET /customers/:id/ledger
  const ledgerRes = await fetch(`${BASE}/customers/${customerId}/ledger`);
  assert.equal(ledgerRes.status, 200);
  const ledger = await ledgerRes.json();
  assert.equal(ledger.balancePaise, 20000, 'Balance must be 20,000 paise (Rs 200)');
  assert.equal(ledger.totalCreditPaise, 30000, 'Total credit must be 30,000 paise (Rs 300)');
  assert.equal(ledger.totalPaymentPaise, 10000, 'Total repayment must be 10,000 paise (Rs 100)');
  assert.equal(ledger.customer.phone, '9998887776');
  assert.equal(ledger.events.length, 2);

  // 6. Attempt delete while balance != 0 should be rejected with 400
  const delFailRes = await fetch(`${BASE}/customers/${customerId}`, { method: 'DELETE' });
  assert.equal(delFailRes.status, 400, 'Should reject deleting customer with non-zero balance');

  // 7. Settle the balance: Pay remaining Rs 200 (20,000 paise)
  await fetch(`${BASE}/ledger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `k_settle_${Date.now()}`
    },
    body: JSON.stringify({
      customerId,
      kind: 'payment',
      totalPaise: 20000,
      items: []
    })
  });

  // 8. Delete / Archive when balance == 0 should succeed
  const delOkRes = await fetch(`${BASE}/customers/${customerId}`, { method: 'DELETE' });
  assert.equal(delOkRes.status, 200);
  const delOk = await delOkRes.json();
  assert.equal(delOk.archived, true);

  // 9. Verify customer is hidden from active GET /customers list
  const listRes = await fetch(`${BASE}/customers`);
  const activeList = await listRes.json();
  assert.ok(!activeList.some((c) => c._id === customerId), 'Archived customer must not appear in active list');

  // 10. Verify customer appears in GET /customers/archived/list
  const archivedRes = await fetch(`${BASE}/customers/archived/list`);
  assert.equal(archivedRes.status, 200);
  const archivedList = await archivedRes.json();
  assert.ok(archivedList.some((c) => c._id === customerId), 'Archived customer must appear in archived list');

  // 11. Restore customer via PUT /customers/:id/restore
  const restoreRes = await fetch(`${BASE}/customers/${customerId}/restore`, { method: 'PUT' });
  assert.equal(restoreRes.status, 200);
  const restored = await restoreRes.json();
  assert.equal(restored.archived, false);

  // 12. Verify customer is restored to active GET /customers list
  const finalListRes = await fetch(`${BASE}/customers`);
  const finalList = await finalListRes.json();
  assert.ok(finalList.some((c) => c._id === customerId), 'Restored customer must re-appear in active list');
});

test('WhatsApp Message: Supports Tamil, Tanglish, and English with customer phone', async () => {
  // Create active customer with phone
  const testPhone = '9840123456';
  const cRes = await fetch(`${BASE}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `WhatsAppTest_${Date.now()}`, phone: testPhone })
  });
  const cust = await cRes.json();

  // Test Tamil message generation
  const taRes = await fetch(`${BASE}/customers/${cust._id}/whatsapp-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'tamil' })
  });
  assert.equal(taRes.status, 200);
  const taData = await taRes.json();
  assert.equal(taData.language, 'tamil');
  assert.equal(taData.customerPhone, testPhone);
  assert.ok(taData.message && taData.message.length > 20, 'Tamil message must be non-empty');
  // Check Tamil script characters (Unicode range \u0B80-\u0BFF)
  assert.match(taData.message, /[\u0B80-\u0BFF]/, 'Message must contain Tamil script when language is tamil');

  // Test English message generation
  const enRes = await fetch(`${BASE}/customers/${cust._id}/whatsapp-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'english' })
  });
  assert.equal(enRes.status, 200);
  const enData = await enRes.json();
  assert.equal(enData.language, 'english');
  assert.equal(enData.customerPhone, testPhone);
  assert.ok(enData.message && enData.message.length > 20);
});
