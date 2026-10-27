import { useEffect } from 'react';
import YazhMascot from './YazhMascot.jsx';

/**
 * YazhResumeModal — Shown when the user refreshes during an unfinished tour,
 * or taps the Help Launcher when an unfinished tour is saved.
 *
 * Offers:
 * - Resume Tour (at the exact saved step)
 * - Start Again (from step 1)
 * - Explore Myself / Dismiss
 */
export default function YazhResumeModal({
  step,
  stepIndex,
  totalSteps,
  onResume,
  onRestart,
  onDismiss,
}) {
  // Keyboard: Escape → dismiss, Enter → resume
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onDismiss();
      if (e.key === 'Enter') onResume();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onResume, onDismiss]);

  const stepNumber = (stepIndex ?? 0) + 1;
  const stepTitle = step?.title || 'Tour Guide';

  return (
    <div
      className="yazh-welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Resume Yazh guided tour"
    >
      <div className="yazh-welcome-card" style={{ position: 'relative' }}>
        {/* Top-right close button */}
        <button
          className="yazh-tooltip-close"
          onClick={onDismiss}
          aria-label="Close resume prompt"
          style={{ position: 'absolute', top: 12, right: 14 }}
        >
          ✕
        </button>

        {/* Mascot */}
        <div className="yazh-welcome-mascot-wrap">
          <YazhMascot assetKey="yazh-thinking" size="large" waving />
        </div>

        <div className="yazh-step-badge" style={{ alignSelf: 'center', margin: '4px 0 8px' }}>
          Step {stepNumber} of {totalSteps}
        </div>

        <h2 className="yazh-welcome-title">
          Welcome Back! 👋
        </h2>

        <p className="yazh-welcome-sub">
          You were exploring <strong>{stepTitle}</strong>. Would you like to resume where you left off, or start from the beginning?
        </p>

        <div className="yazh-welcome-actions">
          <button
            id="yazh-resume-tour-btn"
            className="yazh-btn-primary"
            onClick={onResume}
            autoFocus
            aria-label={`Resume tour at step ${stepNumber}: ${stepTitle}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            Resume Tour (Step {stepNumber})
          </button>

          <button
            id="yazh-restart-tour-btn"
            className="yazh-btn-secondary"
            onClick={onRestart}
            aria-label="Start the tour again from beginning"
          >
            <span style={{ marginRight: 6 }}>↺</span> Start from Beginning
          </button>
        </div>
      </div>
    </div>
  );
}
