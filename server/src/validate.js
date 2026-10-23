import { z } from 'zod';

export const rupeesToPaise = (r) => Math.round(Number(r) * 100);

export const CustomerSchema = z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().max(20).optional() });

export const ItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().max(20).optional(),
  pricePaise: z.number().int().nonnegative().optional()
});

// What the merchant confirms. The AI never sends this directly; the merchant does.
export const OperationSchema = z.object({
  kind: z.enum(['credit', 'payment']),
  totalPaise: z.number().int().positive().max(100000000),
  items: z.array(ItemSchema).max(50).default([])
});

export const ConfirmSchema = z.object({
  customerId: z.string().regex(/^[a-f\d]{24}$/i, 'invalid customer id'),
  kind: z.enum(['credit', 'payment', 'combined']),
  totalPaise: z.number().int().positive().max(100000000).optional(),
  items: z.array(ItemSchema).max(50).default([]),
  operations: z.array(OperationSchema).max(10).optional(),
  source: z.enum(['voice', 'manual']).default('manual'),
  transcript: z.string().max(1000).optional()
}).superRefine((data, ctx) => {
  if (data.kind === 'combined') {
    if (!Array.isArray(data.operations) || data.operations.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Combined transaction must have at least 2 operations (repayment and credit)',
        path: ['operations']
      });
      return;
    }
    const hasPayment = data.operations.some((o) => o.kind === 'payment');
    const hasCredit = data.operations.some((o) => o.kind === 'credit');
    if (!hasPayment || !hasCredit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Combined transaction must include both a payment and a credit operation',
        path: ['operations']
      });
    }
  } else {
    if (data.totalPaise == null || data.totalPaise <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'totalPaise must be a positive integer',
        path: ['totalPaise']
      });
    }
  }
});

export const ReverseSchema = z.object({ reason: z.string().trim().min(3).max(200) });

// Turn the AI service's rupee-based JSON into our paise-based draft.
export function normalizeDraft(ai) {
  const normalizeItems = (list) =>
    (list || []).map((i) => ({
      name: String(i.name || '').trim(),
      quantity: i.quantity ?? undefined,
      unit: i.unit || undefined,
      pricePaise: i.price_rupees != null ? rupeesToPaise(i.price_rupees) : undefined
    })).filter((i) => i.name);

  const topItems = normalizeItems(ai.items);
  const topTotalPaise = ai.total_rupees != null ? rupeesToPaise(ai.total_rupees) : null;

  let operations = [];
  if (Array.isArray(ai.operations) && ai.operations.length > 0) {
    operations = ai.operations.map((op) => ({
      kind: op.type === 'payment' ? 'payment' : 'credit',
      totalPaise: op.total_rupees != null ? rupeesToPaise(op.total_rupees) : null,
      items: normalizeItems(op.items)
    }));
  }

  const isCombined =
    ai.kind === 'combined' ||
    (operations.length >= 2 &&
      operations.some((o) => o.kind === 'payment') &&
      operations.some((o) => o.kind === 'credit'));

  const kind = isCombined ? 'combined' : (ai.kind === 'payment' ? 'payment' : 'credit');

  if (kind === 'combined' && operations.length < 2) {
    operations = [
      { kind: 'payment', totalPaise: null, items: [] },
      { kind: 'credit', totalPaise: topTotalPaise, items: topItems }
    ];
  } else if (kind !== 'combined' && operations.length === 0) {
    operations = [
      { kind, totalPaise: topTotalPaise, items: topItems }
    ];
  }

  return {
    kind,
    customerName: String(ai.customer_name || '').trim(),
    items: topItems,
    totalPaise: topTotalPaise,
    operations,
    transcript: ai.transcript || '',
    confidence: ai.confidence || 'low'
  };
}

// Plausibility check: flag amounts that look like a mishearing (e.g. 150 heard as 1500).
export function amountWarnings(totalPaise, avgCreditPaise, kind = 'credit', operations = []) {
  const w = [];
  if (kind === 'combined') {
    const payOp = operations.find((o) => o.kind === 'payment');
    const credOp = operations.find((o) => o.kind === 'credit');
    if (!payOp || payOp.totalPaise == null) {
      w.push('Repayment amount is missing. Please enter the cash received.');
    }
    if (!credOp || credOp.totalPaise == null) {
      w.push('Credit purchase amount is missing. Please enter the credit purchase total.');
    }
    if (payOp?.totalPaise && payOp.totalPaise > 5000000) {
      w.push('Repayment amount is above Rs 50,000. Please double check.');
    }
    if (credOp?.totalPaise && credOp.totalPaise > 5000000) {
      w.push('Credit purchase amount is above Rs 50,000. Please double check.');
    }
  } else {
    if (totalPaise == null) w.push('No total amount was heard. Please enter it.');
    else {
      if (totalPaise > 5000000) w.push('Amount is above Rs 50,000. Please double check.');
      if (avgCreditPaise && totalPaise > avgCreditPaise * 5) w.push("This is much higher than this customer's usual bill. Please double check.");
    }
  }
  return w;
}
