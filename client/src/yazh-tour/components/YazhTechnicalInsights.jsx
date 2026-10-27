import { useEffect, useState } from 'react';
import YazhMascot from './YazhMascot.jsx';

/**
 * YazhTechnicalInsights — standalone step-6 technical architecture card.
 *
 * Shown as a full bottom-sheet before the normal step-6 tooltip.
 * Switches Yazh's expression from 'thinking' → 'success' after 1.8s.
 *
 * Accuracy rules enforced:
 *   - Claims only verified behavior (503/504/429/timeout failover)
 *   - Does NOT claim: zero downtime, guaranteed 2s, perfect accuracy
 *   - Does NOT claim Groq fires on every error
 *   - Merchant confirmation is always required before ledger write
 *
 * Props:
 *   onContinue  — called when user clicks Continue
 *   onSkip      — called when user clicks Skip Step
 *   onExit      — called when user clicks ✕ (exit tour)
 */
export default function YazhTechnicalInsights({ onContinue, onBack, onSkip, onExit }) {
  const [mascotKey, setMascotKey] = useState('yazh-thinking');

  useEffect(() => {
    const t = setTimeout(() => setMascotKey('yazh-success'), 1800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="yazh-insights-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="AI reliability architecture overview"
    >
      <div className="yazh-insights-card">

        {/* Exit button */}
        <button
          className="yazh-tooltip-close"
          onClick={onExit}
          aria-label="Exit tour"
          style={{ position: 'absolute', top: 12, right: 14 }}
        >✕</button>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <YazhMascot assetKey={mascotKey} size="small" />
          <div className="yazh-insights-title">
            <span>🔐</span> Smart AI Reliability
          </div>
        </div>

        {/* Architecture flow */}
        <div className="yazh-arch-flow" aria-label="AI failover architecture">
          <div className="yazh-arch-step confirm">
            <div className="yazh-arch-dot">🎙️</div>
            <span>Voice transcript</span>
          </div>
          <div className="yazh-arch-arrow">↓</div>
          <div className="yazh-arch-step primary">
            <div className="yazh-arch-dot">✨</div>
            <span>Gemini — Primary extraction</span>
          </div>
          <div className="yazh-arch-arrow">
            ↓ <span style={{ fontSize: 10, opacity: 0.7 }}>on eligible transient failure</span>
          </div>
          <div className="yazh-arch-step secondary">
            <div className="yazh-arch-dot">⚡</div>
            <span>Groq — Independent backup</span>
          </div>
          <div className="yazh-arch-arrow">↓</div>
          <div className="yazh-arch-step validate">
            <div className="yazh-arch-dot">✅</div>
            <span>Structured draft validation</span>
          </div>
          <div className="yazh-arch-arrow">↓</div>
          <div className="yazh-arch-step confirm">
            <div className="yazh-arch-dot">📒</div>
            <span>Merchant confirms → Ledger saved</span>
          </div>
        </div>

        {/* Accuracy disclaimer */}
        <p className="yazh-insights-note">
          Groq activates only on eligible transient failures (503, 504, 429, timeouts).
          Failover is not guaranteed for every error type.
          Your transaction always requires explicit confirmation before it reaches the ledger.
        </p>

        {/* Nav */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {onBack && (
            <button
              className="yazh-nav-back"
              onClick={onBack}
              aria-label="Go back to previous step"
            >
              ← Back
            </button>
          )}
          <button
            className="yazh-nav-next"
            style={{ flex: 1 }}
            onClick={onContinue}
            aria-label="Continue to next tour step"
          >
            Continue →
          </button>
          <button
            className="yazh-nav-skip"
            onClick={onSkip}
            aria-label="Skip this step"
          >
            Skip Step
          </button>
        </div>
      </div>
    </div>
  );
}
