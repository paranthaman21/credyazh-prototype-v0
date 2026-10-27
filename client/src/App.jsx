import { useEffect, useRef, useState } from 'react';
import { api, rupees } from './api.js';
import LiveVoiceModal from './LiveVoiceModal.jsx';
import KalaiAssistantModal from './KalaiAssistantModal.jsx';
import ArchivedCustomersModal from './ArchivedCustomersModal.jsx';
import { recordLatency, getLatencyStats } from './telemetry.js';
import YazhTour from './yazh-tour/index.jsx';

export default function App() {
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('home'); // 'home' | 'customers' | 'entry'
  const [showKalaiModal, setShowKalaiModal] = useState(false);
  const [voiceRecordingState, setVoiceRecordingState] = useState({
    isOpen: false,
    isRecording: false,
    canFinish: false,
    isProcessing: false,
    hasResult: false,
  });

  const refresh = async () => {
    try { setCustomers(await api.customers()); } catch (e) { setError(e.message); }
  };
  useEffect(() => { refresh(); }, []);

  return (
    <div className="app">
      <header>
        <div className="header-brand">
          <h1>CredYazh</h1>
          <span className="header-tagline">Voice-first ledger for merchants</span>
        </div>
        <div className="header-badge">
          <button
            type="button"
            className="kalai-badge-btn"
            onClick={() => setShowKalaiModal(true)}
            title="Ask Kalai AI Assistant for guidance"
            data-tour="tour-kalai-btn"
          >
            <span className="kalai-badge">Ask Kalai AI</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" onClick={() => setError('')}>
          {error} <span className="error-close">Dismiss</span>
        </div>
      )}

      {/* Mobile-first bottom nav */}
      <nav className="bottom-nav">
        <button className={`nav-btn ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>
          <span className="nav-icon">
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" /></svg>
          </span>
          <span>Home</span>
        </button>
        <button className={`nav-btn ${view === 'customers' ? 'active' : ''}`} onClick={() => { setSelected(null); setView('customers'); }}>
          <span className="nav-icon">
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" /></svg>
          </span>
          <span>Customers</span>
        </button>
        <button className={`nav-btn entry-nav-btn ${view === 'entry' ? 'active' : ''}`} onClick={() => setView('entry')}>
          <span className="nav-icon">
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" /></svg>
          </span>
          <span>New Entry</span>
        </button>
      </nav>

      <div className="page-content">
        {view === 'home' && (
          <Dashboard
            customers={customers}
            onSelectCustomer={(id) => { setSelected(id); setView('customers'); }}
          />
        )}

        {view === 'customers' && (
          <div className="customers-page">
            {selected ? (
              <CustomerDetail
                customerId={selected}
                customers={customers}
                onBack={() => setSelected(null)}
                onChanged={refresh}
                onError={setError}
              />
            ) : (
              <CustomerList
                customers={customers}
                onSelect={(id) => setSelected(id)}
                onAdded={refresh}
                onError={setError}
              />
            )}
          </div>
        )}

        {view === 'entry' && (
          <EntryPanel
            customers={customers}
            onSaved={(customerId) => {
              refresh();
              setSelected(customerId);
              setView('customers');
            }}
            onCustomerAdded={refresh}
            onError={setError}
            onVoiceStateChange={setVoiceRecordingState}
          />
        )}
      </div>

      {showKalaiModal && (
        <KalaiAssistantModal
          isOpen={showKalaiModal}
          onClose={() => setShowKalaiModal(false)}
        />
      )}

      {/* ── Yazh Guided Tour — reads view state, never mutates business data ── */}
      <YazhTour
        currentView={view}
        onNavigate={setView}
        onOpenKalai={() => setShowKalaiModal(true)}
        onCloseKalai={() => setShowKalaiModal(false)}
        kalaiIsOpen={showKalaiModal}
        voiceRecordingState={voiceRecordingState}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
function Dashboard({ customers, onSelectCustomer }) {
  const totalOutstanding = customers.reduce((s, c) => s + (c.balancePaise > 0 ? c.balancePaise : 0), 0);
  const customersWithDues = customers.filter((c) => c.balancePaise > 0).length;
  const totalAdvance = customers.reduce((s, c) => s + (c.balancePaise < 0 ? -c.balancePaise : 0), 0);

  const topDebtors = [...customers]
    .filter((c) => c.balancePaise > 0)
    .sort((a, b) => b.balancePaise - a.balancePaise)
    .slice(0, 5);

  return (
    <div className="dashboard">
      <div className="dashboard-greeting">
        <h2>Good {getTimeGreeting()}</h2>
        <p className="dashboard-sub">Account snapshot for today</p>
      </div>

      <div className="summary-cards">
        <div className="summary-card outstanding">
          <div className="summary-card-accent" />
          <div className="summary-card-content">
            <span className="summary-card-label">Total Outstanding</span>
            <span className="summary-card-value">{rupees(totalOutstanding)}</span>
            <span className="summary-card-sub">{customersWithDues} customer{customersWithDues !== 1 ? 's' : ''} owe</span>
          </div>
        </div>

        <div className="summary-card customers-card">
          <div className="summary-card-accent" />
          <div className="summary-card-content">
            <span className="summary-card-label">Total Customers</span>
            <span className="summary-card-value">{customers.length}</span>
            <span className="summary-card-sub">{customers.length - customersWithDues} cleared</span>
          </div>
        </div>

        {totalAdvance > 0 && (
          <div className="summary-card advance-card">
            <div className="summary-card-accent" />
            <div className="summary-card-content">
              <span className="summary-card-label">Advance Received</span>
              <span className="summary-card-value advance-value">{rupees(totalAdvance)}</span>
              <span className="summary-card-sub">Credit balance</span>
            </div>
          </div>
        )}
      </div>

      {topDebtors.length > 0 && (
        <div className="dashboard-section">
          <h3 className="section-title">Pending Collections</h3>
          <div className="debtor-list">
            {topDebtors.map((c) => (
              <button key={c._id} className="debtor-row" onClick={() => onSelectCustomer(c._id)}>
                <div className="debtor-avatar">{c.name.charAt(0).toUpperCase()}</div>
                <div className="debtor-info">
                  <span className="debtor-name">{c.name}</span>
                  <span className="debtor-sub">View ledger</span>
                </div>
                <span className="debtor-amount">{rupees(c.balancePaise)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {customers.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon-text">No customers yet</div>
          <h3>Start adding customers</h3>
          <p>Go to the <strong>Customers</strong> tab to add your first customer, then use <strong>New Entry</strong> to record credit.</p>
        </div>
      )}

      <div className="how-it-works">
        <h3 className="section-title">How CredYazh Works</h3>
        <div className="steps">
          <div className="step"><span className="step-num">1</span><span>Tap <strong>New Entry</strong> and speak naturally in Tamil, Tanglish or English</span></div>
          <div className="step"><span className="step-num">2</span><span>Voice Transaction Engine extracts customer, items and amount draft</span></div>
          <div className="step"><span className="step-num">3</span><span>Review the draft and confirm — entry saves only after your approval</span></div>
          <div className="step"><span className="step-num">4</span><span>Share the balance via <strong>WhatsApp</strong> with one tap</span></div>
        </div>
      </div>
    </div>
  );
}

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─────────────────────────────────────────────────────────────
// CUSTOMER DIRECTORY (CUSTOMER LIST)
// ─────────────────────────────────────────────────────────────
function CustomerList({ customers, onSelect, onAdded, onError }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showArchivedModal, setShowArchivedModal] = useState(false);
  const [adding, setAdding] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      await api.addCustomer({ name: name.trim(), phone: phone.trim() || undefined });
      setName('');
      setPhone('');
      setShowAddForm(false);
      onAdded();
    } catch (err) {
      onError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone && c.phone.includes(search))
  );

  const customersWithDues = customers.filter((c) => c.balancePaise > 0).length;

  return (
    <div className="customer-directory" data-tour="tour-customer-list">
      <div className="directory-header">
        <div>
          <h2>Customers</h2>
          <span className="directory-sub">
            {customers.length} customer{customers.length !== 1 ? 's' : ''} &bull; {customersWithDues} with balance
          </span>
        </div>
        <div className="directory-header-actions">
          <button
            type="button"
            className="btn-archived-toggle"
            onClick={() => setShowArchivedModal(true)}
            title="View and restore archived customer tabs"
          >
            Archived
          </button>
          <button
            type="button"
            className={`btn-toggle-add ${showAddForm ? 'active' : ''}`}
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? '✕ Cancel' : '+ Add Customer'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <form onSubmit={add} className="add-cust-card">
          <h3 className="add-cust-title">New Customer Profile</h3>
          <div className="add-cust-fields">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer full name *"
              autoFocus
              required
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number (optional)"
              type="tel"
            />
          </div>
          <button type="submit" className="primary btn-submit-add" disabled={adding || !name.trim()}>
            {adding ? 'Adding...' : 'Save & Add Customer'}
          </button>
        </form>
      )}

      <div className="search-wrap">
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" className="search-icon">
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
        </svg>
        <input
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer name or phone..."
        />
        {search && (
          <button type="button" className="search-clear" onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      <div className="customer-list-cards">
        {filtered.map((c) => (
          <button
            key={c._id}
            type="button"
            className="customer-item-card"
            onClick={() => onSelect(c._id)}
          >
            <div className="cust-row-left">
              <div className="cust-avatar">{c.name.charAt(0).toUpperCase()}</div>
              <div className="cust-text-info">
                <span className="cust-name">{c.name}</span>
                {c.phone ? (
                  <span className="cust-phone">{c.phone}</span>
                ) : (
                  <span className="cust-phone-placeholder">No phone added</span>
                )}
              </div>
            </div>
            <div className="cust-row-right">
              <span className={`cust-balance-badge ${c.balancePaise > 0 ? 'owes' : c.balancePaise < 0 ? 'advance' : 'cleared'}`}>
                {rupees(c.balancePaise)}
              </span>
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" className="chevron-right">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
              </svg>
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="empty-state">
            <p>No customers match "{search}".</p>
          </div>
        )}
      </div>

      <ArchivedCustomersModal
        isOpen={showArchivedModal}
        onClose={() => setShowArchivedModal(false)}
        onRestored={onAdded}
        onError={onError}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ENTRY PANEL
// ─────────────────────────────────────────────────────────────
function EntryPanel({ customers, onSaved, onCustomerAdded, onError, onVoiceStateChange }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [showVoiceModal, setShowVoiceModal] = useState(false);

  useEffect(() => {
    onVoiceStateChange?.({
      isOpen: showVoiceModal,
      isRecording: false,
      canFinish: false,
      isProcessing: busy,
      hasResult: Boolean(result),
    });
  }, [showVoiceModal, busy, result, onVoiceStateChange]);

  const gotDraft = (r) => {
    setResult({ ...r, key: crypto.randomUUID() });
    onVoiceStateChange?.({
      isOpen: false,
      isRecording: false,
      canFinish: false,
      isProcessing: false,
      hasResult: true,
    });
  };
  const manual = () => setResult({
    draft: { kind: 'credit', customerName: '', items: [], totalPaise: null, transcript: '', confidence: 'high' },
    candidates: [], warnings: [], key: crypto.randomUUID(), source: 'manual'
  });

  const fromText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const t0 = Date.now();
    try {
      const res = await api.draftFromText(text);
      const totalDurationMs = Date.now() - t0;
      recordLatency({
        type: 'text',
        model: res.metrics?.geminiModel || 'gemini-3.5-flash-lite',
        totalMs: totalDurationMs,
        geminiMs: res.metrics?.geminiLatencyMs || 0,
        serverMs: res.metrics?.serverTotalMs || 0,
        encodingMs: 0
      });
      gotDraft({ ...res, clientMetrics: { totalDurationMs } });
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVoiceDraft = async (wavBlob, meta = {}) => {
    setBusy(true);
    const t0 = Date.now();
    try {
      const res = await api.draftFromAudio(wavBlob, meta.signal);
      const totalDurationMs = Date.now() - t0;
      recordLatency({
        type: 'audio',
        model: res.metrics?.geminiModel || 'gemini-3.5-flash-lite',
        totalMs: totalDurationMs,
        geminiMs: res.metrics?.geminiLatencyMs || 0,
        serverMs: res.metrics?.serverTotalMs || 0,
        encodingMs: meta.encodingDurationMs || 0
      });
      gotDraft({
        ...res,
        clientMetrics: {
          totalDurationMs,
          encodingDurationMs: meta.encodingDurationMs || 0
        }
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (result) return (
    <Review
      result={result}
      customers={customers}
      onCancel={() => setResult(null)}
      onError={onError}
      onCustomerAdded={onCustomerAdded}
      onSaved={(id) => { setResult(null); setText(''); onSaved(id); }}
    />
  );

  return (
    <section className="card entry-card" data-tour="tour-entry-panel">
      <div className="entry-header">
        <h2>New Entry</h2>
        <span className="entry-sub">Speak, type, or enter manually</span>
      </div>

      <button className="mic live-mic-btn" data-tour="tour-voice-btn" onClick={() => setShowVoiceModal(true)} disabled={busy}>
        {busy ? (
          <><span className="spinner-dot" /><span>Processing with Voice Engine (Gemini)...</span></>
        ) : (
          <>
            <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
            <span>Record Voice Note</span>
          </>
        )}
      </button>

      <div className="language-pills">
        <span className="pill">Tamil</span>
        <span className="pill">Tanglish</span>
        <span className="pill">English</span>
        <span className="pill-hint">all supported</span>
      </div>

      <p className="example-hint">
        <span className="example-label">Example:</span> "Kumar account-la 1 kg arisi, rendu packet paal, total 85 rupees"
      </p>

      <div className="divider"><span>or type it</span></div>
      <div className="row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type the sentence here..."
          onKeyDown={(e) => e.key === 'Enter' && fromText()}
        />
        <button onClick={fromText} disabled={busy || !text.trim()}>Extract</button>
      </div>

      <div className="divider"><span>or</span></div>
      <button type="button" className="btn-manual-entry" onClick={manual}>
        <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15" style={{ flexShrink: 0 }}>
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
        </svg>
        <span>Enter Manually</span>
      </button>

      <LiveVoiceModal
        isOpen={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        onError={onError}
        onDraftGenerated={handleVoiceDraft}
        onSwitchToManual={manual}
        onRecordingStateChange={(state) => {
          onVoiceStateChange?.({
            isOpen: showVoiceModal,
            isRecording: state.isRecording,
            canFinish: state.canFinish,
            isProcessing: state.isProcessing,
            hasResult: Boolean(result),
          });
        }}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// REVIEW
// ─────────────────────────────────────────────────────────────
function Review({ result, customers, onCancel, onSaved, onCustomerAdded, onError }) {
  const { draft, candidates, warnings, key } = result;
  const stats = getLatencyStats();
  const only = candidates.length === 1 ? candidates[0].id : '';
  const [customerId, setCustomerId] = useState(only);

  const initialPayOp = draft.operations?.find((o) => o.kind === 'payment');
  const initialCredOp = draft.operations?.find((o) => o.kind === 'credit');

  const [kind, setKind] = useState(draft.kind || 'credit'); // 'credit' | 'payment' | 'combined'
  const [total, setTotal] = useState(draft.totalPaise != null ? String(draft.totalPaise / 100) : '');
  const [items, setItems] = useState(draft.items || []);

  // Separate states for combined transactions
  const [paymentTotal, setPaymentTotal] = useState(
    initialPayOp?.totalPaise != null
      ? String(initialPayOp.totalPaise / 100)
      : draft.kind === 'payment' && draft.totalPaise != null
        ? String(draft.totalPaise / 100)
        : ''
  );
  const [creditTotal, setCreditTotal] = useState(
    initialCredOp?.totalPaise != null
      ? String(initialCredOp.totalPaise / 100)
      : draft.kind === 'credit' && draft.totalPaise != null
        ? String(draft.totalPaise / 100)
        : ''
  );
  const [creditItems, setCreditItems] = useState(
    initialCredOp?.items?.length ? initialCredOp.items : draft.items || []
  );

  const [saving, setSaving] = useState(false);

  const detectedName = (draft.customerName || '').trim();
  const existingMatch = detectedName
    ? customers.find((c) => c.name.trim().toLowerCase() === detectedName.toLowerCase())
    : null;
  const isNewCustomer = Boolean(detectedName && !existingMatch && candidates.length === 0 && result.source !== 'manual');
  const [showNewCustModal, setShowNewCustModal] = useState(isNewCustomer);
  const [custNameInput, setCustNameInput] = useState(detectedName);
  const [addingCust, setAddingCust] = useState(false);

  const handleAddNewCustomer = async (e) => {
    if (e) e.preventDefault();
    const finalName = custNameInput.trim() || detectedName;
    if (!finalName) return;
    setAddingCust(true);
    try {
      const created = await api.addCustomer({ name: finalName });
      if (onCustomerAdded) await onCustomerAdded();
      if (created?._id) setCustomerId(String(created._id));
      setShowNewCustModal(false);
    } catch (err) { onError(err.message); } finally { setAddingCust(false); }
  };

  const setItem = (i, patch) => setItems(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  const setCreditItem = (i, patch) => setCreditItems(creditItems.map((it, n) => (n === i ? { ...it, ...patch } : it)));

  const selectedCustomer = customers.find((c) => c._id === customerId);
  const selectedCustomerName = selectedCustomer?.name || '';
  const currentBalancePaise = selectedCustomer?.balancePaise || 0;

  const isCombined = kind === 'combined';
  const totalPaise = Math.round(parseFloat(total || '0') * 100);
  const paymentPaise = Math.round(parseFloat(paymentTotal || '0') * 100);
  const creditPaise = Math.round(parseFloat(creditTotal || '0') * 100);

  const ready = isCombined
    ? Boolean(customerId && paymentPaise > 0 && creditPaise > 0)
    : Boolean(customerId && totalPaise > 0);

  // Projected balance calculation
  const projectedPaise = isCombined
    ? currentBalancePaise - paymentPaise + creditPaise
    : kind === 'credit'
      ? currentBalancePaise + totalPaise
      : currentBalancePaise - totalPaise;

  const confirm = async () => {
    setSaving(true);
    try {
      if (isCombined) {
        await api.confirm({
          customerId,
          kind: 'combined',
          operations: [
            { kind: 'payment', totalPaise: paymentPaise, items: [] },
            {
              kind: 'credit',
              totalPaise: creditPaise,
              items: creditItems.filter((i) => i.name.trim()).map((i) => ({
                name: i.name,
                quantity: i.quantity || undefined,
                unit: i.unit || undefined,
                pricePaise: i.pricePaise
              }))
            }
          ],
          source: result.source || 'voice',
          transcript: draft.transcript || undefined
        }, key);
      } else {
        await api.confirm({
          customerId,
          kind,
          totalPaise,
          items: kind === 'credit'
            ? items.filter((i) => i.name.trim()).map((i) => ({
                name: i.name,
                quantity: i.quantity || undefined,
                unit: i.unit || undefined,
                pricePaise: i.pricePaise
              }))
            : [],
          source: result.source || 'voice',
          transcript: draft.transcript || undefined
        }, key);
      }
      onSaved(customerId);
    } catch (e) { onError(e.message); } finally { setSaving(false); }
  };

  return (
    <section className="card review">
      {showNewCustModal && (
        <div className="new-cust-modal-backdrop" onClick={() => setShowNewCustModal(false)}>
          <div className="new-cust-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="new-cust-icon-circle">
              <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="new-cust-title">New Customer Detected</h3>
            <p className="new-cust-message">
              <strong>"{detectedName}"</strong> is not in your customer list.<br />
              Would you like to add them now?
            </p>
            <form onSubmit={handleAddNewCustomer} className="new-cust-form">
              <div className="new-cust-name-row">
                <label htmlFor="modal-cust-name">Customer Name</label>
                <input
                  id="modal-cust-name"
                  className="new-cust-name-input"
                  value={custNameInput}
                  onChange={(e) => setCustNameInput(e.target.value)}
                  placeholder="Enter customer name"
                  autoFocus
                />
              </div>
              <div className="new-cust-actions">
                <button type="submit" className="btn-add-customer primary" disabled={addingCust || !custNameInput.trim()}>
                  {addingCust ? 'Adding...' : 'Add to Customer List'}
                </button>
                <button type="button" className="btn-skip-customer" onClick={() => setShowNewCustModal(false)} disabled={addingCust}>
                  Skip
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="review-header">
        <div>
          <h2>Review Entry</h2>
          <span className="review-sub">Verify amounts and customer before saving</span>
        </div>
        <div className="review-badges">
          {isCombined && <span className="combined-tag">Combined Transaction</span>}
          <span className="review-ai-badge">AI Draft</span>
        </div>
      </div>

      {result.metrics && (
        <div className="latency-telemetry-bar">
          <div className="latency-chip model-chip">
            <span className="telemetry-dot" />
            <span>{result.metrics.geminiModel}</span>
          </div>
          <div className="latency-chip time-chip">
            <span>⚡ {result.clientMetrics?.totalDurationMs ? `${(result.clientMetrics.totalDurationMs / 1000).toFixed(2)}s` : `${(result.metrics.geminiLatencyMs / 1000).toFixed(2)}s`}</span>
          </div>
          {stats.count > 1 && (
            <div className="latency-chip stats-chip" title="Rolling session p50 and p95 latency">
              <span>p50: {(stats.p50 / 1000).toFixed(2)}s</span>
              <span className="chip-sep">•</span>
              <span>p95: {(stats.p95 / 1000).toFixed(2)}s</span>
            </div>
          )}
          {(() => {
            const attempts = result.metrics.modelsAttempted || [];
            const actualAttempts = attempts.filter((a) => a.status || a.latency_ms > 0);
            const count = actualAttempts.length > 0 ? actualAttempts.length : attempts.length;
            const isMultiAttempt = count > 1;
            const trace = result.metrics.failoverTrace;

            if (!isMultiAttempt && !result.metrics.failoverTriggered && !trace) return null;

            return (
              <div
                className="latency-chip fallback-chip"
                title={trace || `${count} actual provider/model attempts`}
              >
                <span>{trace ? `Failover: ${trace}` : `Failover (${count} attempts)`}</span>
              </div>
            );
          })()}
        </div>
      )}

      {draft.transcript && (
        <div className="transcript-box">
          <span className="transcript-tag">Spoken Note Transcript</span>
          <p className="transcript-text">"{draft.transcript}"</p>
        </div>
      )}

      {warnings.map((w) => <p className="warn" key={w}>{w}</p>)}

      <label>Customer
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Choose customer...</option>
          {customers.map((c) => <option key={c._id} value={c._id}>{c.name} ({rupees(c.balancePaise)})</option>)}
        </select>
      </label>

      {detectedName && !existingMatch && !customerId && (
        <div className="new-cust-quick-banner">
          <span><strong>"{detectedName}"</strong> is not in your list yet.</span>
          <button type="button" className="btn-quick-add" onClick={() => { setCustNameInput(detectedName); setShowNewCustModal(true); }}>
            + Add "{detectedName}"
          </button>
        </div>
      )}

      <label>Transaction Type
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="combined">Combined — Repayment &amp; New Credit</option>
          <option value="credit">Credit — goods given</option>
          <option value="payment">Payment — cash received</option>
        </select>
      </label>

      {/* COMBINED TRANSACTION UI */}
      {isCombined ? (
        <div className="combined-sections">
          <div className="operation-box payment-op-box">
            <div className="op-header">
              <span className="op-title">1. Repayment Received</span>
              <span className="op-badge payment-op-badge">Cash in</span>
            </div>
            <label>Amount Received (Rs.)
              <input
                type="number"
                step="0.01"
                value={paymentTotal}
                onChange={(e) => setPaymentTotal(e.target.value)}
                placeholder="200.00"
              />
            </label>
          </div>

          <div className="operation-box credit-op-box">
            <div className="op-header">
              <span className="op-title">2. New Credit Purchase</span>
              <span className="op-badge credit-op-badge">Credit out</span>
            </div>

            <div className="items-section">
              <div className="items-section-header">
                <span className="items-label">Purchased Items ({creditItems.length})</span>
                <span className="items-hint">Products, quantities &amp; units</span>
              </div>
              {creditItems.map((it, i) => (
                <div className="item-row" key={i}>
                  <input className="item-name-input" value={it.name} onChange={(e) => setCreditItem(i, { name: e.target.value })} placeholder="Item name" />
                  <input className="item-qty-input" type="number" step="any" value={it.quantity ?? ''} onChange={(e) => setCreditItem(i, { quantity: e.target.value ? Number(e.target.value) : undefined })} placeholder="Qty" />
                  <input className="item-unit-input" value={it.unit ?? ''} onChange={(e) => setCreditItem(i, { unit: e.target.value })} placeholder="kg/pkt" />
                  <button type="button" className="btn-remove-item" onClick={() => setCreditItems(creditItems.filter((_, n) => n !== i))}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                  </button>
                </div>
              ))}
              <button type="button" className="btn-add-item" onClick={() => setCreditItems([...creditItems, { name: '' }])}>
                + Add Item
              </button>
            </div>

            <label>Credit Purchase Total (Rs.)
              <input
                type="number"
                step="0.01"
                value={creditTotal}
                onChange={(e) => setCreditTotal(e.target.value)}
                placeholder="70.00"
              />
            </label>
          </div>

          {/* Combined Calculation & Live Net Impact Preview */}
          {customerId && (
            <div className="combined-preview-card">
              <div className="combined-preview-header">
                <span className="combined-preview-title">Combined Transaction Calculation</span>
                {selectedCustomerName && <span className="combined-preview-cust">{selectedCustomerName}</span>}
              </div>
              <div className="calc-breakdown">
                <div className="calc-row">
                  <span>Current Outstanding Balance:</span>
                  <span className="calc-val">{rupees(currentBalancePaise)}</span>
                </div>
                <div className="calc-row pay-row">
                  <span>Repayment Received (Cash):</span>
                  <span className="calc-val pay-val">- {rupees(paymentPaise)}</span>
                </div>
                <div className="calc-row credit-row">
                  <span>New Credit Purchase:</span>
                  <span className="calc-val credit-val">+ {rupees(creditPaise)}</span>
                </div>
                <div className="calc-divider" />
                <div className="calc-row total-row">
                  <span>New Resulting Balance:</span>
                  <span className={`calc-val ${projectedPaise > 0 ? 'owes' : projectedPaise < 0 ? 'advance' : 'cleared'}`}>
                    {rupees(projectedPaise)}
                  </span>
                </div>
              </div>
              {paymentPaise > currentBalancePaise && currentBalancePaise > 0 && (
                <div className="excess-repayment-note">
                  Notice: Repayment exceeds current dues. {rupees(paymentPaise - currentBalancePaise)} will remain as advance credit balance.
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* SINGLE TRANSACTION UI */
        <div>
          {kind === 'credit' && (
            <div className="items-section">
              <div className="items-section-header">
                <span className="items-label">Items ({items.length})</span>
                <span className="items-hint">Products, quantities &amp; units</span>
              </div>
              {items.map((it, i) => (
                <div className="item-row" key={i}>
                  <input className="item-name-input" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Item name" />
                  <input className="item-qty-input" type="number" step="any" value={it.quantity ?? ''} onChange={(e) => setItem(i, { quantity: e.target.value ? Number(e.target.value) : undefined })} placeholder="Qty" />
                  <input className="item-unit-input" value={it.unit ?? ''} onChange={(e) => setItem(i, { unit: e.target.value })} placeholder="kg/pkt" />
                  <button type="button" className="btn-remove-item" onClick={() => setItems(items.filter((_, n) => n !== i))}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                  </button>
                </div>
              ))}
              <button type="button" className="btn-add-item" onClick={() => setItems([...items, { name: '' }])}>
                + Add Item
              </button>
            </div>
          )}

          <label>Total Amount (Rs.)
            <input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" />
          </label>

          {ready && (
            <div className="confirm-preview">
              <span className="confirm-preview-label">
                {kind === 'credit' ? 'Adding credit of' : 'Recording payment of'}
              </span>
              <span className="confirm-preview-amount">{rupees(totalPaise)}</span>
              {selectedCustomerName && <span className="confirm-preview-cust">for {selectedCustomerName}</span>}
              <div className="confirm-preview-sub">
                Current: {rupees(currentBalancePaise)} &rarr; New Balance: {rupees(projectedPaise)}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="row confirm-actions">
        <button className="primary confirm-btn" disabled={!ready || saving} onClick={confirm}>
          {saving ? 'Saving...' : isCombined ? 'Confirm Combined Entry' : 'Confirm & Save'}
        </button>
        <button onClick={onCancel} disabled={saving}>Discard</button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// CUSTOMER DETAIL & STATEMENT VIEW
// ─────────────────────────────────────────────────────────────
function CustomerDetail({ customerId, customers, onBack, onChanged, onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'credit' | 'payment' | 'reversal'

  // Modals state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editing, setEditing] = useState(false);

  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditNote, setCreditNote] = useState('');
  const [creditSubmitting, setCreditSubmitting] = useState(false);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [whatsAppPhone, setWhatsAppPhone] = useState('');
  const [whatsAppMessage, setWhatsAppMessage] = useState('');
  const [whatsAppLanguage, setWhatsAppLanguage] = useState('tamil');
  const [whatsAppLoading, setWhatsAppLoading] = useState(false);

  const customer = data?.customer || customers.find((c) => c._id === customerId);

  const load = async () => {
    try {
      setLoading(true);
      const res = await api.ledger(customerId);
      setData(res);
    } catch (e) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [customerId]);

  const handleEditSave = async (e) => {
    e.preventDefault();
    if (!editName.trim()) return;
    setEditing(true);
    try {
      await api.updateCustomer(customerId, {
        name: editName.trim(),
        phone: editPhone.trim() || undefined
      });
      setShowEditModal(false);
      await load();
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setEditing(false);
    }
  };

  const handleArchiveConfirm = async () => {
    setArchiving(true);
    try {
      await api.deleteCustomer(customerId);
      setShowArchiveModal(false);
      onChanged();
      onBack();
    } catch (err) {
      onError(err.message);
    } finally {
      setArchiving(false);
    }
  };

  const handleQuickCredit = async (e) => {
    e.preventDefault();
    const val = parseFloat(creditAmount);
    if (!val || val <= 0) return;
    setCreditSubmitting(true);
    try {
      const items = creditNote.trim() ? [{ name: creditNote.trim() }] : [];
      await api.confirm({
        customerId,
        kind: 'credit',
        totalPaise: Math.round(val * 100),
        items,
        source: 'manual'
      }, crypto.randomUUID());
      setCreditAmount('');
      setCreditNote('');
      setShowCreditModal(false);
      await load();
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setCreditSubmitting(false);
    }
  };

  const handleQuickPayment = async (e) => {
    e.preventDefault();
    const val = parseFloat(paymentAmount);
    if (!val || val <= 0) return;
    setPaymentSubmitting(true);
    try {
      await api.confirm({
        customerId,
        kind: 'payment',
        totalPaise: Math.round(val * 100),
        items: [],
        source: 'manual'
      }, crypto.randomUUID());
      setPaymentAmount('');
      setShowPaymentModal(false);
      await load();
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const reverse = async (id) => {
    const reason = window.prompt('Reason for reversal (audit trail will record this event):');
    if (!reason || !reason.trim()) return;
    try {
      await api.reverse(id, reason.trim());
      await load();
      onChanged();
    } catch (e) {
      onError(e.message);
    }
  };

  const buildLocalStatement = (lang) => {
    if (!customer || !data) return '';
    const balance = rupees(data.balancePaise);
    const creditTotal = rupees(data.totalCreditPaise || 0);
    const paymentTotal = rupees(data.totalPaymentPaise || 0);
    const activeEvents = (data.events || []).filter((e) => e.type !== 'REVERSAL' && !e.isReversed);

    if (lang === 'tamil') {
      const recentLines = activeEvents
        .slice(0, 5)
        .map((e) => {
          const date = new Date(e.createdAt).toLocaleDateString('ta-IN', { day: 'numeric', month: 'short' });
          const items = e.items?.map((i) => i.name).join(', ') || (e.type === 'CREDIT' ? 'கடன் கொள்முதல்' : 'பணம் செலுத்தியது');
          const amt = rupees(Math.abs(e.signedAmountPaise));
          const direction = e.type === 'CREDIT' ? 'கடன்' : 'வரவு';
          return `  - ${date} | ${items} | ${direction}: ${amt}`;
        })
        .join('\n');

      return (
        `*CredYazh கணக்கு விவரம்*\n` +
        `வணக்கம் ${customer.name},\n` +
        `தேதி: ${new Date().toLocaleDateString('ta-IN', { day: 'numeric', month: 'short', year: 'numeric' })}\n\n` +
        `*நிலுவை தொகை: ${balance}*\n` +
        `மொத்த கடன்: ${creditTotal}\n` +
        `மொத்த திருப்பிச் செலுத்தியது: ${paymentTotal}\n\n` +
        (recentLines ? `சமீபத்திய பரிவர்த்தனைகள்:\n${recentLines}\n\n` : '') +
        `உங்கள் தொடர் ஆதரவிற்கு நன்றி!\n` +
        `_CredYazh மூலமாக அனுப்பப்பட்டது — வணிகர்களுக்கான குரல் லெட்ஜர்_`
      );
    }

    if (lang === 'tanglish') {
      const recentLines = activeEvents
        .slice(0, 5)
        .map((e) => {
          const date = new Date(e.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
          const items = e.items?.map((i) => i.name).join(', ') || (e.type === 'CREDIT' ? 'Credit purchase' : 'Payment received');
          const amt = rupees(Math.abs(e.signedAmountPaise));
          const direction = e.type === 'CREDIT' ? 'Credit' : 'Repayment';
          return `  - ${date} | ${items} | ${direction}: ${amt}`;
        })
        .join('\n');

      return (
        `*CredYazh Account Statement*\n` +
        `Vanakkam ${customer.name},\n` +
        `Date: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}\n\n` +
        `*Current Balance: ${balance}*\n` +
        `Total Credit: ${creditTotal}\n` +
        `Total Repayments: ${paymentTotal}\n\n` +
        (recentLines ? `Recent Transactions:\n${recentLines}\n\n` : '') +
        `Ungal support-ku nandri!\n` +
        `_Sent via CredYazh — Voice Ledger for Merchants_`
      );
    }

    // Default English
    const recentLines = activeEvents
      .slice(0, 5)
      .map((e) => {
        const date = new Date(e.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const items = e.items?.map((i) => i.name).join(', ') || (e.type === 'CREDIT' ? 'Credit purchase' : 'Payment received');
        const amt = rupees(Math.abs(e.signedAmountPaise));
        const direction = e.type === 'CREDIT' ? 'Credit' : 'Repayment';
        return `  - ${date} | ${items} | ${direction}: ${amt}`;
      })
      .join('\n');

    return (
      `*CredYazh Account Statement*\n` +
      `Customer: *${customer.name}*\n` +
      `Date: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}\n\n` +
      `*Outstanding Balance: ${balance}*\n` +
      `Total Purchases: ${creditTotal}\n` +
      `Total Repayments: ${paymentTotal}\n\n` +
      (recentLines ? `Recent Transactions:\n${recentLines}\n\n` : '') +
      `Thank you for your business!\n` +
      `_Sent via CredYazh — Voice Ledger for Merchants_`
    );
  };

  const handleWhatsAppLangChange = async (lang) => {
    setWhatsAppLanguage(lang);
    // Instant visualization in the textarea for the selected language
    const immediateText = buildLocalStatement(lang);
    setWhatsAppMessage(immediateText);

    // Call API for AI-prepared polite phrasing
    setWhatsAppLoading(true);
    try {
      const res = await api.generateWhatsAppMessage(customer._id || customerId, lang);
      if (res && res.message) {
        setWhatsAppMessage(res.message);
      }
    } catch (err) {
      console.warn('AI WhatsApp message generation failed, keeping structured template:', err);
    } finally {
      setWhatsAppLoading(false);
    }
  };

  const shareWhatsApp = () => {
    if (!customer || !data) return;
    // Pre-fill with customer's existing saved phone number
    setWhatsAppPhone(customer.phone || '');
    setShowWhatsAppModal(true);
    // Immediately visualize the statement in the currently active language
    handleWhatsAppLangChange(whatsAppLanguage);
  };

  if (loading && !data) {
    return (
      <div className="customer-detail-view">
        <div className="detail-nav-bar">
          <button type="button" className="btn-back" onClick={onBack}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd"/>
            </svg>
            <span>Back to Customers</span>
          </button>
        </div>
        <div className="card loading-card">
          <div className="spinner-dot" />
          <p>Loading customer statement...</p>
        </div>
      </div>
    );
  }

  if (!data || !customer) {
    return (
      <div className="customer-detail-view">
        <div className="detail-nav-bar">
          <button type="button" className="btn-back" onClick={onBack}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd"/>
            </svg>
            <span>Back to Customers</span>
          </button>
        </div>
        <div className="empty-state">
          <h3>Customer not found</h3>
          <p>This customer record could not be loaded or was removed.</p>
        </div>
      </div>
    );
  }

  const events = data.events || [];
  const creditCount = events.filter((e) => e.type === 'CREDIT' && !e.isReversed).length;
  const paymentCount = events.filter((e) => e.type === 'PAYMENT' && !e.isReversed).length;
  const reversalCount = events.filter((e) => e.type === 'REVERSAL' || e.isReversed).length;

  const filteredEvents = events.filter((e) => {
    if (filter === 'credit') return e.type === 'CREDIT' && !e.isReversed;
    if (filter === 'payment') return e.type === 'PAYMENT' && !e.isReversed;
    if (filter === 'reversal') return e.type === 'REVERSAL' || e.isReversed;
    return true;
  });

  const isCleared = data.balancePaise === 0;
  const isInAdvance = data.balancePaise < 0;

  return (
    <div className="customer-detail-view">
      {/* Top Navigation */}
      <div className="detail-nav-bar">
        <button type="button" className="btn-back" onClick={onBack}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd"/>
          </svg>
          <span>Back to Customers</span>
        </button>

        <div className="detail-header-actions">
          <button
            type="button"
            className="btn-header-action"
            onClick={() => {
              setEditName(customer.name);
              setEditPhone(customer.phone || '');
              setShowEditModal(true);
            }}
            title="Edit Customer Details"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
            </svg>
            <span>Edit</span>
          </button>

          <button
            type="button"
            className="btn-header-action danger"
            onClick={() => setShowArchiveModal(true)}
            title="Archive Customer"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
            <span>Archive</span>
          </button>
        </div>
      </div>

      {/* Customer Hero Profile Card */}
      <section className="card customer-hero-card">
        <div className="hero-top-row">
          <div className="hero-identity">
            <div className="hero-avatar">{customer.name.charAt(0).toUpperCase()}</div>
            <div className="hero-info">
              <h2 className="hero-name">{customer.name}</h2>
              <div className="hero-phone-wrap">
                {customer.phone ? (
                  <a href={`tel:${customer.phone}`} className="hero-phone-link" title="Call customer">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                      <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 4V3z"/>
                    </svg>
                    <span>{customer.phone}</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    className="hero-add-phone-btn"
                    onClick={() => {
                      setEditName(customer.name);
                      setEditPhone('');
                      setShowEditModal(true);
                    }}
                  >
                    + Add phone number
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="hero-badge-wrap">
            <span className={`balance-tag ${data.balancePaise > 0 ? 'owes-tag' : isCleared ? 'cleared-tag' : 'advance-tag'}`}>
              {data.balancePaise > 0
                ? `Owes ${rupees(data.balancePaise)}`
                : isInAdvance
                  ? `Advance ${rupees(-data.balancePaise)}`
                  : 'Account Cleared'}
            </span>
          </div>
        </div>

        {/* 3 Financial Metrics */}
        <div className="statement-metrics-grid">
          <div className={`metric-card ${data.balancePaise > 0 ? 'due-card' : isInAdvance ? 'advance-card' : 'settled-card'}`}>
            <span className="metric-label">Outstanding Balance</span>
            <span className="metric-value">{rupees(data.balancePaise)}</span>
            <span className="metric-sub">
              {data.balancePaise > 0 ? 'Pending collection' : isInAdvance ? 'Excess paid' : 'Zero balance'}
            </span>
          </div>

          <div className="metric-card credit-metric-card">
            <span className="metric-label">Total Credit Given</span>
            <span className="metric-value">{rupees(data.totalCreditPaise || 0)}</span>
            <span className="metric-sub">{creditCount} purchases on credit</span>
          </div>

          <div className="metric-card payment-metric-card">
            <span className="metric-label">Total Repayments</span>
            <span className="metric-value">{rupees(data.totalPaymentPaise || 0)}</span>
            <span className="metric-sub">{paymentCount} cash payments</span>
          </div>
        </div>

        {/* Action Bar */}
        <div className="customer-action-bar">
          <button
            type="button"
            className="btn-statement-action credit-action"
            onClick={() => setShowCreditModal(true)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/>
            </svg>
            <span>Add Credit</span>
          </button>

          <button
            type="button"
            className="btn-statement-action payment-action"
            onClick={() => setShowPaymentModal(true)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
            </svg>
            <span>Record Payment</span>
          </button>

          <button
            type="button"
            className="btn-statement-action whatsapp-action"
            onClick={shareWhatsApp}
            title="Share full statement on WhatsApp"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
            </svg>
            <span>Share WhatsApp</span>
          </button>
        </div>
      </section>

      {/* Statement History Card */}
      <section className="card history-card">
        <div className="history-header">
          <div>
            <h3>Transaction History</h3>
            <span className="history-sub">
              {events.length} total recorded event{events.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Filter Pills */}
          <div className="history-filter-pills">
            <button
              type="button"
              className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({events.length})
            </button>
            <button
              type="button"
              className={`filter-pill ${filter === 'credit' ? 'active' : ''}`}
              onClick={() => setFilter('credit')}
            >
              Credit ({creditCount})
            </button>
            <button
              type="button"
              className={`filter-pill ${filter === 'payment' ? 'active' : ''}`}
              onClick={() => setFilter('payment')}
            >
              Repayments ({paymentCount})
            </button>
            {reversalCount > 0 && (
              <button
                type="button"
                className={`filter-pill ${filter === 'reversal' ? 'active' : ''}`}
                onClick={() => setFilter('reversal')}
              >
                Reversals ({reversalCount})
              </button>
            )}
          </div>
        </div>

        {/* Independent Scrollable Table Container */}
        <div className="ledger-table-wrap history-scroll-wrap">
          <table>
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Description</th>
                <th>Type</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((e) => {
                const isCredit = e.type === 'CREDIT' && !e.isReversed;
                const isPayment = e.type === 'PAYMENT' && !e.isReversed;
                const isRev = e.type === 'REVERSAL' || e.isReversed;

                return (
                  <tr key={e._id} className={e.isReversed ? 'struck' : ''}>
                    <td className="date-col">
                      {new Date(e.createdAt).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td>
                      {e.type === 'REVERSAL' ? (
                        <span className="reversal-label">Audit Reversal — {e.reason}</span>
                      ) : (
                        e.items?.map((i) => `${i.name}${i.quantity ? ` ${i.quantity}${i.unit || ''}` : ''}`).join(', ') ||
                        (e.type === 'PAYMENT' ? 'Cash payment received' : 'Credit purchase')
                      )}
                      {e.groupId && <span className="combined-badge" title="Combined repayment & credit">Combined</span>}
                      {e.source === 'voice' && <span className="voice-badge">Voice</span>}
                    </td>
                    <td>
                      <span className={`entry-type-tag ${isCredit ? 'credit-tag' : isPayment ? 'payment-tag' : 'reversal-tag'}`}>
                        {isRev ? 'Reversed' : isCredit ? 'Credit' : 'Repayment'}
                      </span>
                    </td>
                    <td className={e.signedAmountPaise > 0 ? 'owes' : 'credit-amt'}>
                      {e.signedAmountPaise > 0
                        ? rupees(e.signedAmountPaise)
                        : `-${rupees(Math.abs(e.signedAmountPaise))}`}
                    </td>
                    <td className="actions-col">
                      {e.type !== 'REVERSAL' && !e.isReversed && (
                        <button type="button" className="btn-reverse-link" onClick={() => reverse(e._id)}>
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredEvents.length === 0 && (
                <tr>
                  <td colSpan="5" className="empty-history-cell">
                    <p className="empty-history-text">
                      {filter === 'all'
                        ? 'No transactions recorded yet. Tap "+ Add Credit" to add the first entry.'
                        : `No ${filter} entries found.`}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit Customer Modal */}
      {showEditModal && (
        <div className="voice-modal-backdrop" onClick={() => !editing && setShowEditModal(false)}>
          <div className="modal-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-dialog-header">
              <h3>Edit Customer Details</h3>
              <button
                type="button"
                className="voice-close-btn"
                disabled={editing}
                onClick={() => setShowEditModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleEditSave} className="modal-form">
              <label>
                Customer Full Name *
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Kumar"
                  required
                  autoFocus
                />
              </label>

              <label>
                Phone Number (optional)
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="voice-btn-cancel"
                  disabled={editing}
                  onClick={() => setShowEditModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary voice-btn-submit"
                  disabled={editing || !editName.trim()}
                >
                  {editing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Credit Modal */}
      {showCreditModal && (
        <div className="voice-modal-backdrop" onClick={() => !creditSubmitting && setShowCreditModal(false)}>
          <div className="modal-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-dialog-header">
              <h3>Add Credit — {customer.name}</h3>
              <button
                type="button"
                className="voice-close-btn"
                disabled={creditSubmitting}
                onClick={() => setShowCreditModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleQuickCredit} className="modal-form">
              <label>
                Amount (Rs.) *
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  placeholder="e.g. 150.00"
                  required
                  autoFocus
                />
              </label>

              <label>
                Item description / Note (optional)
                <input
                  type="text"
                  value={creditNote}
                  onChange={(e) => setCreditNote(e.target.value)}
                  placeholder="e.g. Rice 2kg, Cooking oil"
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="voice-btn-cancel"
                  disabled={creditSubmitting}
                  onClick={() => setShowCreditModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary voice-btn-submit"
                  disabled={creditSubmitting || !creditAmount || parseFloat(creditAmount) <= 0}
                >
                  {creditSubmitting ? 'Saving...' : 'Save Credit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Record Payment Modal */}
      {showPaymentModal && (
        <div className="voice-modal-backdrop" onClick={() => !paymentSubmitting && setShowPaymentModal(false)}>
          <div className="modal-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-dialog-header">
              <h3>Record Repayment — {customer.name}</h3>
              <button
                type="button"
                className="voice-close-btn"
                disabled={paymentSubmitting}
                onClick={() => setShowPaymentModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleQuickPayment} className="modal-form">
              <label>
                Cash Received (Rs.) *
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="e.g. 200.00"
                  required
                  autoFocus
                />
              </label>

              <p className="modal-helper-text">
                Current outstanding balance: <strong>{rupees(data.balancePaise)}</strong>
              </p>

              <div className="modal-actions">
                <button
                  type="button"
                  className="voice-btn-cancel"
                  disabled={paymentSubmitting}
                  onClick={() => setShowPaymentModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary voice-btn-submit"
                  disabled={paymentSubmitting || !paymentAmount || parseFloat(paymentAmount) <= 0}
                >
                  {paymentSubmitting ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive Customer Modal */}
      {showArchiveModal && (
        <div className="voice-modal-backdrop" onClick={() => !archiving && setShowArchiveModal(false)}>
          <div className="modal-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-dialog-header">
              <h3>Archive Customer</h3>
              <button
                type="button"
                className="voice-close-btn"
                disabled={archiving}
                onClick={() => setShowArchiveModal(false)}
              >
                ✕
              </button>
            </div>

            {data.balancePaise !== 0 ? (
              <div className="modal-body-content">
                <div className="archive-warning-box">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" className="warn-icon">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                  </svg>
                  <div>
                    <strong>Cannot archive with active balance</strong>
                    <p>
                      {customer.name} currently has a non-zero balance of{' '}
                      <strong>{rupees(data.balancePaise)}</strong>.
                      For financial accuracy, please record a repayment or reverse entries before archiving.
                    </p>
                  </div>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="primary voice-btn-submit"
                    onClick={() => setShowArchiveModal(false)}
                  >
                    Understood
                  </button>
                </div>
              </div>
            ) : (
              <div className="modal-body-content">
                <p className="archive-confirm-text">
                  Are you sure you want to archive <strong>{customer.name}</strong>?
                  Their account is fully settled (0 balance) and will be hidden from the active customer directory.
                  Historical ledger audit records will remain securely stored.
                </p>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="voice-btn-cancel"
                    disabled={archiving}
                    onClick={() => setShowArchiveModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-danger-submit"
                    disabled={archiving}
                    onClick={handleArchiveConfirm}
                  >
                    {archiving ? 'Archiving...' : 'Archive Customer'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    {showWhatsAppModal && (
      <div className="voice-modal-backdrop" onClick={() => !whatsAppLoading && setShowWhatsAppModal(false)}>
        <div className="modal-dialog-card whatsapp-modal-card" onClick={e => e.stopPropagation()}>
          <div className="modal-dialog-header">
            <div className="whatsapp-modal-title">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#25D366">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
              <h3>Share via WhatsApp</h3>
            </div>
            <button type="button" className="voice-close-btn" disabled={whatsAppLoading} onClick={() => setShowWhatsAppModal(false)}>
              ✕
            </button>
          </div>
          <div className="modal-body-content">
            <div className="whatsapp-field-group">
              <label className="whatsapp-label">
                <span>Customer Phone Number</span>
                <input
                  type="tel"
                  className="whatsapp-phone-input"
                  value={whatsAppPhone}
                  onChange={e => setWhatsAppPhone(e.target.value)}
                  placeholder="e.g. 9876543210 (or leave blank to choose in WhatsApp)"
                  disabled={whatsAppLoading}
                />
              </label>
              {customer?.phone && (
                <span className="whatsapp-phone-hint">
                  ✓ Saved customer number detected: <strong>{customer.phone}</strong>
                </span>
              )}
            </div>

            <div className="whatsapp-field-group">
              <div className="whatsapp-lang-header">
                <label className="whatsapp-label" htmlFor="whatsapp-lang-select">
                  <span>Language</span>
                </label>
                {whatsAppLoading && (
                  <span className="whatsapp-ai-badge">Polishing with AI...</span>
                )}
              </div>
              <select
                id="whatsapp-lang-select"
                className="whatsapp-select"
                value={whatsAppLanguage}
                onChange={e => handleWhatsAppLangChange(e.target.value)}
                disabled={whatsAppLoading}
              >
                <option value="tamil">தமிழ் (Tamil)</option>
                <option value="tanglish">Tanglish (Tamil in English)</option>
                <option value="english">English</option>
              </select>
            </div>

            <div className="whatsapp-field-group">
              <label className="whatsapp-label">
                <span>Statement Message (Review & Edit)</span>
                <textarea
                  className="whatsapp-textarea"
                  rows={9}
                  value={whatsAppMessage}
                  onChange={e => setWhatsAppMessage(e.target.value)}
                  placeholder="Statement message will appear here..."
                  disabled={whatsAppLoading}
                />
              </label>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="voice-btn-cancel" disabled={whatsAppLoading} onClick={() => setShowWhatsAppModal(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary voice-btn-submit whatsapp-send-btn"
              disabled={whatsAppLoading || !whatsAppMessage.trim()}
              onClick={() => {
                const rawPhone = (whatsAppPhone || customer?.phone || '').trim();
                const digits = rawPhone.replace(/\D/g, '');
                let finalPhone = '';
                if (digits) {
                  if (digits.length === 10) {
                    finalPhone = `91${digits}`;
                  } else if (digits.length === 12 && digits.startsWith('91')) {
                    finalPhone = digits;
                  } else {
                    finalPhone = digits;
                  }
                }
                const url = finalPhone
                  ? `https://wa.me/${finalPhone}?text=${encodeURIComponent(whatsAppMessage)}`
                  : `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsAppMessage)}`;
                window.open(url, '_blank');
                setShowWhatsAppModal(false);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
              <span>{whatsAppLoading ? 'Preparing...' : 'Open WhatsApp'}</span>
            </button>
          </div>
        </div>
      </div>
    )}
</div>
  );
}

