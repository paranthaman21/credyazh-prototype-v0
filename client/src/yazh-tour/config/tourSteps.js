// ─────────────────────────────────────────────────────────────
// Yazh Tour — Step Definitions
// All seven steps. Each step declares:
//   id, asset, targetView, targetDataAttr, dialogue, subtext?
// targetView: the view state the app must be in ('home'|'customers'|'entry'|'kalai')
// targetDataAttr: data-tour="…" attribute on the element to spotlight
// ─────────────────────────────────────────────────────────────

export const TOUR_STEPS = [
  {
    id: 'welcome',
    step: 1,
    asset: 'yazh-welcome',
    targetView: 'home',
    targetDataAttr: null, // no spotlight — full welcome screen
    title: 'Vanakkam! 👋',
    dialogue:
      "I'm Yazh, your CredYazh guide! Let me show you how everyday shop conversations become digital ledger entries.",
    subtext: null,
    mascotSize: 'large',
  },
  {
    id: 'voice',
    step: 2,
    asset: 'yazh-listening',
    targetView: 'entry',
    targetDataAttr: 'tour-voice-btn',
    title: 'Speak Naturally',
    dialogue:
      'Busy at the counter? Just speak in Tamil, Tanglish, or English. CredYazh turns your words into a transaction draft.',
    subtext: '"Kumar account-la ara kilo paruppu, oru litre paal, motham 160 roova."',
    mascotSize: 'medium',
  },
  {
    id: 'review',
    step: 3,
    asset: 'yazh-explaining',
    targetView: 'entry',
    targetDataAttr: 'tour-entry-panel',
    title: 'AI Drafts, You Decide',
    dialogue:
      'AI prepares the draft, but you\'re in control! Review the customer, items, and amount before saving. If a price is missing, CredYazh won\'t guess.',
    subtext: null,
    mascotSize: 'medium',
  },
  {
    id: 'ledger',
    step: 4,
    asset: 'yazh-pointing',
    targetView: 'customers',
    targetDataAttr: 'tour-customer-list',
    title: 'Customer Ledger & Balances',
    dialogue:
      'Every credit and payment has its place. Check customer balances and transaction history whenever you need them.',
    subtext: 'Example: ₹500 balance − ₹200 payment + ₹70 new credit = ₹370 updated balance.',
    mascotSize: 'medium',
  },
  {
    id: 'kalai',
    step: 5,
    asset: 'yazh-explaining',
    targetView: 'kalai',
    targetDataAttr: 'tour-kalai-btn',
    title: 'Meet Kalai',
    dialogue:
      'Meet Kalai, our AI assistant inside CredYazh! Right now, Kalai helps you with text-based guidance on voice entry, combined repayments, WhatsApp sharing, and more. Our team is working to make Kalai even more helpful in future updates!',
    subtextShort:
      'Kalai currently guides you through voice entry, repayments, WhatsApp sharing, and other features. More improvements are on the way!',
    subtext:
      'Kalai is your product guide — not the voice extraction engine. Gemini & Groq handle transaction extraction separately.',
    kalaiStep: true, // triggers compact Yazh mode when Kalai modal is open
    mascotSize: 'medium',
  },
  {
    id: 'reliability',
    step: 6,
    asset: 'yazh-thinking',
    assetSuccess: 'yazh-success',
    targetView: 'home',
    targetDataAttr: null,
    title: 'Smart AI Reliability',
    dialogue:
      'Behind the scenes, CredYazh uses Gemini as its primary AI and Groq as an independent backup for eligible transient failures.',
    subtext:
      'Your transaction still needs your confirmation before it reaches the ledger.',
    mascotSize: 'medium',
  },
  {
    id: 'finish',
    step: 7,
    asset: 'yazh-goodbye',
    targetView: 'home',
    targetDataAttr: null,
    title: 'Now It\'s Your Turn!',
    dialogue:
      "Nandri! That's CredYazh. I'm here whenever you need guidance. Ready to record your first entry?",
    subtext: null,
    mascotSize: 'large',
  },
];

export const TOTAL_STEPS = TOUR_STEPS.length;
export { TOUR_STORAGE_KEY, getTourState, saveTourState, clearTourState } from './tourStorage.js';
