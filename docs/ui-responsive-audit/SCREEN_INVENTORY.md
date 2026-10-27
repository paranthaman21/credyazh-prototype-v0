# CredYazh Mobile-First Responsive UI & Screen Inventory Audit

**Audit Date:** 2026-10-27  
**Branch:** `feature/ai-latency-optimization`  
**Application Type:** Progressive Web App (PWA) for Indian Kirana & Grocery Merchants  
**Stack:** React 18.3.1, Vite 5.4.0, Vanilla CSS Tokens  

---

## 1. Complete Application Screen & Route Inventory

CredYazh uses single-page view navigation with persistent bottom navigation on mobile:

| View/Screen | Path/State | Primary User Action | Overlays / Modals Present | Current Layout Constraints & Responsive Status |
|---|---|---|---|---|
| **Dashboard** | `view === 'home'` | View account dues, top debtors, quick jump to customer ledger | Kalai AI badge in header, Yazh Tour Launcher | 2-column grid at `<640px`, 3-column at `>640px`. Debtors list needs flexible amount wrapping. |
| **New Entry (EntryPanel)** | `view === 'entry'` | Record voice note, extract text note, manual entry | `LiveVoiceModal`, `Review` sub-view | Mic button (`tour-voice-btn`), lang pills, text input, Enter Manually button. |
| **Live Voice Recording** | `showVoiceModal === true` | Speak Kirana note in Tamil/Tanglish/English, tap "Finish & Process" | `LiveVoiceModal` dialog on `voice-modal-backdrop` | Fixed 480px canvas, button row with `min-width: 0` needed on `<360px`. |
| **Review Entry** | Sub-view of `entry` when `result !== null` | Inspect draft fields, select customer, tap "Confirm & Save" | `New Customer Detected` modal, `YazhTooltip` | **Critical screen:** Must ensure item rows, totals, and confirm buttons never clip or get covered by Yazh. |
| **Customer Directory** | `view === 'customers'` & `selected === null` | Search customer, view balances, "+ Add Customer", view archived | Inline Add Customer form, `ArchivedCustomersModal` | Filter pills, search bar, customer cards with balances and status badges. |
| **Customer Detail & Ledger** | `view === 'customers'` & `selected !== null` | View ledger statement, "+ Credit", "+ Payment", WhatsApp statement | `EditCustomerModal`, `QuickCreditModal`, `QuickPaymentModal`, `ArchiveModal`, `WhatsAppModal` | Action bar with 3 primary buttons, filter pills, timeline items, reversal buttons. |
| **Kalai AI Assistant** | `showKalaiModal === true` | Learn merchant accounting rules, voice phrase guides, atomic ledger tips | `KalaiAssistantModal` dialog | Modal with topic pills and language bar. Needs responsive height & scrolling on `<400px`. |
| **Yazh Guided Tour** | `tourEnabled` across 7 steps | Follow interactive tour, step next/skip/exit, replay tour | `YazhWelcome`, `YazhTooltip`, `YazhResumeModal`, `YazhHelpLauncher` | Mobile bottom sheet. Position and z-index must strictly stay below financial controls. |

---

## 2. Comprehensive Overlay & Modal Inventory

| Modal / Overlay | Trigger Component | Current Z-Index | Mobile Layout (`<430px`) | Target Tablet / Desktop Layout |
|---|---|---|---|---|
| **Live Voice Modal** | Mic button in Entry | `1000` | Centered dialog (`max-width: 500px`) | Centered modal with audio visualizer |
| **New Customer Modal** | Review (unrecognized name) | `1200` | Centered card (`max-width: 420px`) | Centered dialog |
| **Edit Customer Modal** | Customer Detail header | `1000` | Centered card (`max-width: 460px`) | Centered dialog |
| **Quick Credit Modal** | Customer Detail action bar | `1000` | Centered card (`max-width: 460px`) | Centered dialog |
| **Quick Payment Modal** | Customer Detail action bar | `1000` | Centered card (`max-width: 460px`) | Centered dialog |
| **Archive Customer Modal** | Customer Detail options | `1000` | Centered card (`max-width: 460px`) | Centered dialog |
| **WhatsApp Statement Modal** | Customer Detail action bar | `1000` | Centered card (`max-width: 500px`) | Centered dialog |
| **Archived Customers Modal** | Customer Directory header | `1000` | Centered card (`max-width: 500px`) | Centered dialog |
| **Kalai Assistant Modal** | Header badge / Tour step 5 | `1000` | Centered card (`max-width: 560px`) | Full responsive dialog with scrollable content |
| **Yazh Spotlight Overlay** | Yazh Tour active step | `9050` | SVG full-screen mask | SVG mask with transparent cutout |
| **Yazh Tooltip Sheet** | Yazh Tour steps 2-5, 7 | `9400` | Fixed bottom sheet | Compact card anchored near bottom |
| **Yazh Voice Compact Bar** | Yazh Tour during voice modal | `9600` | Floating pill above bottom nav | Floating pill |
| **Yazh Help Launcher** | Yazh Tour idle state | `8900` | Floating circle bottom-right | Floating circle bottom-right |

---

## 3. Detailed Layout & Responsiveness Problem Log

1. **Z-Index Collision:**
   - Yazh tooltips (`9400`) and compact bar (`9600`) sit above normal modals (`1000`). If a merchant opens a modal, Yazh must never obstruct confirmation buttons.
2. **Review Entry on Small Mobile (320px–375px):**
   - The item row input grid (`item-name-input`, `item-qty-input`, `item-unit-input`, `btn-remove-item`) compresses too tightly on screens under 360px without proper responsive flex wrapping.
3. **Modal Dialogs Scroll Safety:**
   - Modals use `max-height: 90vh` or fixed sizing without explicit safe-area inset accounting (`100dvh` and `env(safe-area-inset-bottom)`), causing buttons to get cut off on mobile Safari and Chrome when virtual keyboards open.
4. **Kalai Assistant Modal Scrolling:**
   - On short viewports (`<600px` height) or small mobile screens, the Kalai topic card can push the "Got it, thanks!" button off screen.
5. **Customer Detail Action Bar:**
   - 3 buttons ("+ Credit", "+ Payment", "WhatsApp") in a row can wrap awkwardly on 320px screens.
