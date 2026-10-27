import { useEffect, useRef } from 'react';
import YazhMascot from './YazhMascot.jsx';
import YazhSpotlight from './YazhSpotlight.jsx';
import YazhTapIndicator from './YazhTapIndicator.jsx';
import YazhTechnicalInsights from './YazhTechnicalInsights.jsx';
import { TOUR_STEPS } from '../config/tourSteps.js';

// Steps where tap indicator should be shown (empty to prevent distracting hand/tap badges)
const TAP_INDICATOR_STEPS = [];

/**
 * YazhTooltip — the main bottom-sheet tooltip shown during steps 2–7.
 *
 * Props:
 *   step               — current step object from TOUR_STEPS
 *   stepIndex          — 0-based index
 *   totalSteps         — total number of steps
 *   onNext             — handleNextStep()
 *   onBack             — handlePreviousStep()
 *   onSkipStep         — handleSkipStep() — skips ONLY this step, tour stays active
 *   onExitTour         — handleExitTour() — closes the entire tour
 *   onFinishTour       — handleFinishTour() — completes tour from final step
 *   onNavigate         — app view navigation callback
 *   kalaiIsOpen        — boolean, true when the Kalai modal is currently open
 */
export default function YazhTooltip({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onBack,
  onSkipStep,
  onExitTour,
  onFinishTour,
  onNavigate,
  kalaiIsOpen = false,
  voiceRecordingState = null,
}) {
  const closeRef = useRef(null);
  const isFirst        = stepIndex === 0;
  const isLast         = stepIndex === totalSteps - 1;
  const isReliability  = step.id === 'reliability';
  const isFinish       = step.id === 'finish';
  const isKalai        = step.id === 'kalai';
  const isVoiceStep    = step.id === 'voice';
  const isReviewStep   = step.id === 'review';

  // Voice recording contextual state
  const isVoiceModalOpen = Boolean(voiceRecordingState?.isOpen);
  const isRecordingActive = Boolean(voiceRecordingState?.isRecording);
  const canFinishNote = Boolean(voiceRecordingState?.canFinish);
  const isProcessingVoice = Boolean(voiceRecordingState?.isProcessing);
  const hasVoiceResult = Boolean(voiceRecordingState?.hasResult);

  // In voice step, minimize bubble when modal is open or recording is active
  const voiceCompact = isVoiceStep && (isVoiceModalOpen || isRecordingActive);
  // Kalai compact mode: Yazh shrinks into a mini banner when Kalai modal is open
  const kalaiCompact = isKalai && kalaiIsOpen;

  // Focus close button on each new step (unless recording modal is active)
  useEffect(() => {
    if (!isVoiceModalOpen) {
      closeRef.current?.focus();
    }
  }, [stepIndex, isVoiceModalOpen]);

  // Escape → exit tour
  useEffect(() => {
    const handler = (e) => {
      // If voice modal is open, don't let Escape kill the tour; modal handles its own cancel
      if (isVoiceModalOpen) return;
      if (e.key === 'Escape') onExitTour();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onExitTour, isVoiceModalOpen]);

  // ── Step 6: Technical Insights ────────────────────────────
  if (isReliability) {
    return (
      <YazhTechnicalInsights
        onContinue={onNext}
        onBack={onBack}
        onSkip={onSkipStep}
        onExit={onExitTour}
      />
    );
  }

  // ── Kalai compact mode: tiny banner so Kalai modal is visible ──
  if (kalaiCompact) {
    return (
      <div
        className="yazh-kalai-compact-bar"
        role="complementary"
        aria-label="Yazh tour: Kalai step — use Continue when ready"
      >
        <YazhMascot assetKey="yazh-explaining" size="small" className="yazh-compact-mascot" />
        <div className="yazh-kalai-compact-text">
          <span className="yazh-kalai-compact-title">Explore Kalai!</span>
          <span className="yazh-kalai-compact-sub">Close Kalai when ready to continue.</span>
        </div>
        <div className="yazh-kalai-compact-actions">
          <button className="yazh-nav-next yazh-compact-btn" onClick={onNext} aria-label="Continue tour">
            Continue →
          </button>
          <button className="yazh-nav-skip" onClick={onSkipStep} aria-label="Skip Kalai step">
            Skip
          </button>
          <button className="yazh-tooltip-close yazh-compact-close" onClick={onExitTour} aria-label="Exit tour">
            ✕
          </button>
        </div>
      </div>
    );
  }

  // ── Voice Step Compact Mode (Active Recording) ────────────
  // When user actually clicks Record Voice Note, minimize guide so recording controls remain visible!
  if (voiceCompact) {
    let dialogueText = "I'm listening! Take your time.";
    let mascotAsset = "yazh-listening";
    let showFinishPointer = false;

    if (isProcessingVoice) {
      dialogueText = "CredYazh is preparing your draft. Please wait!";
      mascotAsset = "yazh-thinking";
    } else if (canFinishNote) {
      dialogueText = "Great! Now tap Finish Process to turn your voice note into a transaction draft.";
      mascotAsset = "yazh-pointing";
      showFinishPointer = true;
    } else if (hasVoiceResult) {
      dialogueText = "Your draft is ready! Review the details before confirming.";
      mascotAsset = "yazh-welcome";
    }

    return (
      <>
        <div
          className="yazh-voice-compact-bar"
          role="complementary"
          aria-label="Yazh tour: Recording active"
        >
          <YazhMascot assetKey={mascotAsset} size="small" className="yazh-compact-mascot" />
          <div className="yazh-kalai-compact-text">
            <span className="yazh-kalai-compact-title">
              {isProcessingVoice ? "Processing Draft..." : canFinishNote ? "Ready to Process!" : "Recording Active"}
            </span>
            <span className="yazh-kalai-compact-sub">{dialogueText}</span>
          </div>
          <div className="yazh-kalai-compact-actions">
            <button
              className="yazh-tooltip-close yazh-compact-close"
              onClick={onExitTour}
              aria-label="Exit tour"
              title="Exit tour (recording will continue)"
            >
              ✕
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Normal tooltip sheet ────────────────────────────────────
  // Scenario A: If user hasn't clicked Record Voice Note yet, show tap indicator on Record Voice Note
  // Stop tap indicator immediately once recording has begun
  const showTapIndicator =
    TAP_INDICATOR_STEPS.includes(step.id) &&
    step.targetDataAttr &&
    !kalaiIsOpen &&
    !isVoiceModalOpen;

  // Contextual dialogue for step 2 before recording begins
  const displayDialogue = isVoiceStep
    ? "Tap Record Voice Note to speak your transaction naturally!"
    : step.dialogue;

  return (
    <>
      {/* SVG spotlight dim overlay — only when voice modal is not active */}
      <YazhSpotlight
        targetAttr={step.targetDataAttr}
        active={Boolean(step.targetDataAttr) && !isVoiceModalOpen}
        dimBg={!isKalai && !isVoiceModalOpen}
      />

      {/* Animated tap indicator */}
      {showTapIndicator && (
        <YazhTapIndicator
          targetAttr={step.targetDataAttr}
          active={true}
        />
      )}

      <div
        className={`yazh-tooltip-sheet ${isReviewStep ? 'yazh-review-compact-sheet' : ''}`}
        role="complementary"
        aria-label={`Tour step ${stepIndex + 1} of ${totalSteps}: ${step.title}`}
      >
        <div className={`yazh-tooltip-card ${isReviewStep ? 'yazh-review-compact-card' : ''}`}>
          {/* Exit button (top-right) */}
          <button
            ref={closeRef}
            className="yazh-tooltip-close"
            onClick={onExitTour}
            aria-label="Exit tour"
            tabIndex={0}
          >
            ✕
          </button>

          {/* Mascot */}
          <YazhMascot assetKey={step.asset} size="medium" />

          <div className="yazh-tooltip-body">
            {/* Progress row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div className="yazh-step-badge">
                Step {stepIndex + 1}/{totalSteps}
              </div>
              <div className="yazh-step-dots" aria-hidden="true">
                {TOUR_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`yazh-step-dot ${i === stepIndex ? 'active' : i < stepIndex ? 'done' : ''}`}
                  />
                ))}
              </div>
            </div>

            <div className="yazh-tooltip-title">{step.title}</div>
            <p className="yazh-tooltip-dialogue">{displayDialogue}</p>

            {step.subtext && (
              <p className="yazh-tooltip-subtext">{step.subtext}</p>
            )}

            {/* ── Finish step actions ── */}
            {isFinish ? (
              <div className="yazh-finish-actions">
                <button
                  className="yazh-finish-btn-primary"
                  onClick={() => { onNavigate('entry'); onFinishTour(); }}
                  aria-label="Go to New Entry"
                >
                  🎙️ Try New Entry
                </button>
                <button
                  className="yazh-finish-btn-outline"
                  onClick={() => { onNavigate('customers'); onFinishTour(); }}
                  aria-label="Explore the Customers section"
                >
                  👥 Explore Customers
                </button>
                <button
                  className="yazh-finish-btn-outline"
                  onClick={onFinishTour}
                  aria-label="Finish the tour"
                >
                  ✓ Finish Tour
                </button>
                <button
                  className="yazh-nav-back"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={onBack}
                  aria-label="Go back to previous step"
                >
                  ← Back
                </button>
              </div>
            ) : (
              /* ── Normal step navigation ── */
              <div className="yazh-tooltip-nav">
                <button
                  className="yazh-nav-back"
                  onClick={onBack}
                  disabled={isFirst}
                  aria-label="Go to previous step"
                >
                  ← Back
                </button>
                <button
                  className="yazh-nav-next"
                  onClick={onNext}
                  aria-label="Go to next step"
                >
                  Next →
                </button>
                <button
                  className="yazh-nav-skip"
                  onClick={onSkipStep}
                  aria-label="Skip this step"
                  title="Skip this step only — tour stays open"
                >
                  Skip Step
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
