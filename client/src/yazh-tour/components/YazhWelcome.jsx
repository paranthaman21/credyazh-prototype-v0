import { useEffect } from 'react';
import YazhMascot from './YazhMascot.jsx';

/**
 * YazhWelcome — the polished first-visit welcome screen.
 * Shows when phase === 'offer'.
 * Blocks interaction with the app underneath (focus trap via aria-modal).
 */
export default function YazhWelcome({ onStart, onSkip, onExit, tourMode = false, replayMode = false }) {
  // Keyboard: Escape → skip/exit, Enter → start/next
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (onExit) onExit();
        else onSkip();
      }
      if (e.key === 'Enter') onStart();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onStart, onSkip, onExit]);

  return (
    <div
      className="yazh-welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Yazh guided tour welcome"
    >
      <div className="yazh-welcome-card" style={{ position: 'relative' }}>
        {/* Exit button in tourMode or replayMode */}
        {(tourMode || replayMode) && onExit && (
          <button
            className="yazh-tooltip-close"
            onClick={onExit}
            aria-label="Exit tour"
            style={{ position: 'absolute', top: 12, right: 14 }}
          >
            ✕
          </button>
        )}

        {/* Mascot peeking above the card */}
        <div className="yazh-welcome-mascot-wrap">
          <YazhMascot assetKey="yazh-welcome" size="large" waving />
        </div>

        <h2 className="yazh-welcome-title">
          {replayMode ? (
            <>Ready for a Tour? <span>Yazh</span> இங்கே 👋</>
          ) : (
            <>Vanakkam! <span>Yazh</span> இங்கே 👋</>
          )}
        </h2>

        <p className="yazh-welcome-sub">
          {tourMode
            ? "I'm Yazh, your CredYazh guide! Let me show you how everyday shop conversations become digital ledger entries."
            : replayMode
            ? "Ready for a refresher? I'll walk you through voice entries, customer accounts, and Kalai AI."
            : "New to CredYazh? I'll show you how it works in about a minute."}
        </p>

        <div className="yazh-welcome-actions">
          <button
            id="yazh-start-tour-btn"
            className="yazh-btn-primary"
            onClick={onStart}
            autoFocus
            aria-label={tourMode ? "Next tour step" : "Take a quick product tour with Yazh"}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            {tourMode ? "Next →" : replayMode ? "Start Tour (7 Steps)" : "Take a Quick Tour"}
          </button>

          <button
            id="yazh-skip-tour-btn"
            className="yazh-btn-secondary"
            onClick={onSkip}
            aria-label={tourMode ? "Skip welcome step" : "Skip tour and explore CredYazh yourself"}
          >
            {tourMode ? "Skip Step" : replayMode ? "Close" : "Explore Myself"}
          </button>
        </div>
      </div>
    </div>
  );
}
