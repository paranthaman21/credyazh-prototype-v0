import mongoose from 'mongoose';

// One shop for the prototype. Real multi-tenant auth comes later (see README).
export const SHOP_ID = 'demo-shop';

const customerSchema = new mongoose.Schema(
  {
    shopId: { type: String, default: SHOP_ID, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    archived: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

const itemSchema = new mongoose.Schema(
  { name: { type: String, required: true }, quantity: Number, unit: String, pricePaise: Number },
  { _id: false }
);

// Ledger events are append-only. We never edit or delete one; a mistake is fixed
// by adding a REVERSAL event that cancels the original.
// signedAmountPaise: CREDIT is +, PAYMENT is -, REVERSAL is the opposite of the event it cancels.
const ledgerEventSchema = new mongoose.Schema(
  {
    shopId: { type: String, default: SHOP_ID, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    type: { type: String, enum: ['CREDIT', 'PAYMENT', 'REVERSAL'], required: true },
    signedAmountPaise: { type: Number, required: true },
    items: [itemSchema],
    source: { type: String, enum: ['voice', 'manual'], default: 'manual' },
    transcript: String,
    idempotencyKey: String,
    reversesEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEvent' },
    reason: String,
    // Auditable link for combined operations (e.g. repayment + credit grouped under one interaction)
    groupId: { type: String, index: true },
    batchIndex: { type: Number, default: 0 }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// One request key = one entry. A retry or double tap cannot create a second bill.
ledgerEventSchema.index({ shopId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
ledgerEventSchema.index({ shopId: 1, groupId: 1 }, { partialFilterExpression: { groupId: { $type: 'string' } } });
// An event can be reversed only once.
ledgerEventSchema.index({ reversesEventId: 1 }, { unique: true, partialFilterExpression: { reversesEventId: { $type: 'objectId' } } });

export const Customer = mongoose.model('Customer', customerSchema);
export const LedgerEvent = mongoose.model('LedgerEvent', ledgerEventSchema);
