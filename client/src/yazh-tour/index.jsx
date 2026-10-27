import { useEffect, useRef } from 'react';
import { useYazhTour } from './hooks/useYazhTour.js';
import YazhWelcome from './components/YazhWelcome.jsx';
import YazhResumeModal from './components/YazhResumeModal.jsx';
import YazhTooltip from './components/YazhTooltip.jsx';
import YazhHelpLauncher from './components/YazhHelpLauncher.jsx';
import './styles/yazhTour.css';

const SUPPORTED_ROUTES = ['home', 'customers', 'entry'];

/**
 * YazhTour — top-level orchestrator.
 *
 * Props:
 *   currentView          — current app view string ('home'|'customers'|'entry')
 *   onNavigate           — callback(view) to change the app view
 *   onOpenKalai          — callback() to open the Kalai modal
 *   onCloseKalai         — callback() to close the Kalai modal
 *   kalaiIsOpen          — boolean, true when Kalai modal is currently visible
 *   voiceRecordingState  — object tracking live voice modal and recording status
 *   suppressLauncher     — boolean, optional override to hide launcher
 */
export default function YazhTour({
  currentView,
  onNavigate,
  onOpenKalai,
  onCloseKalai,
  kalaiIsOpen = false,
  voiceRecordingState = null,
  suppressLauncher = false,
}) {
  const {
    tourEnabled,
    phase,
    stepIndex,
    currentStep,
    totalSteps,
    startTour,
    startTourAt,
    resumeTour,
    restartTour,
    handleNextStep,
    handlePreviousStep,
    handleSkipStep,
    handleExitTour,
    handleDismissPrompt,
    handleFinishTour,
    replayTour,
  } = useYazhTour();

  // Track whether Kalai was opened BY the tour (so only we close it on exit)
  const kalaiOpenedByTour = useRef(false);

  // Navigate the app to the required view for each step
  useEffect(() => {
    if (phase !== 'running') return;
    const targetView = currentStep.targetView;

    if (targetView === 'kalai') {
      // Kalai is a modal, not a view — navigate to home first, then open modal
      if (currentView !== 'home') onNavigate('home');
      const t = setTimeout(() => {
        if (!kalaiIsOpen) {
          kalaiOpenedByTour.current = true;
          onOpenKalai();
        }
      }, 300);
      return () => clearTimeout(t);
    }

    // Leaving the Kalai step — if tour opened it, close it cleanly
    if (kalaiOpenedByTour.current && kalaiIsOpen) {
      kalaiOpenedByTour.current = false;
      onCloseKalai?.();
    }

    if (currentView !== targetView) {
      onNavigate(targetView);
    }
  }, [phase, stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExit = () => {
    if (kalaiOpenedByTour.current && kalaiIsOpen) {
      kalaiOpenedByTour.current = false;
      onCloseKalai?.();
    }
    handleExitTour();
  };

  const handleFinish = () => {
    if (kalaiOpenedByTour.current && kalaiIsOpen) {
      kalaiOpenedByTour.current = false;
      onCloseKalai?.();
    }
    handleFinishTour();
  };

  if (!tourEnabled) return null;

  // Route check: do not render on login or onboarding screens
  const isExcludedRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname.includes('/login') ||
     window.location.pathname.includes('/onboarding') ||
     !SUPPORTED_ROUTES.includes(currentView));

  // ── Phase: offer (first visit) ───────────────────────────
  if (phase === 'offer') {
    return (
      <YazhWelcome
        onStart={startTour}
        onSkip={handleFinish} // "Explore Myself" = skip entire offer and mark done
      />
    );
  }

  // ── Phase: resume (refreshed during unfinished tour) ──────
  if (phase === 'resume') {
    return (
      <YazhResumeModal
        step={currentStep}
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        onResume={resumeTour}
        onRestart={restartTour}
        onDismiss={handleDismissPrompt}
      />
    );
  }

  // ── Phase: replay_offer (user tapped launcher) ───────────
  if (phase === 'replay_offer') {
    return (
      <YazhWelcome
        replayMode
        onStart={startTour}
        onSkip={handleDismissPrompt}
        onExit={handleDismissPrompt}
      />
    );
  }

  // ── Phase: running ───────────────────────────────────────
  if (phase === 'running') {
    if (currentStep.id === 'welcome') {
      return (
        <YazhWelcome
          tourMode
          onStart={handleNextStep}
          onSkip={handleSkipStep} // skip step 1 only → goes to step 2
          onExit={handleExit}
        />
      );
    }

    return (
      <YazhTooltip
        step={currentStep}
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        onNext={handleNextStep}
        onBack={handlePreviousStep}
        onSkipStep={handleSkipStep}
        onExitTour={handleExit}
        onFinishTour={handleFinish}
        onNavigate={onNavigate}
        kalaiIsOpen={kalaiIsOpen}
        voiceRecordingState={voiceRecordingState}
      />
    );
  }

  // ── Phase: done (tour dismissed/finished/idle) ───────────
  // Floating Help Launcher remains visible across supported routes!
  // Hide during active modal, open Kalai, or when Review Entry has a draft (so Confirm & Discard are never blocked)
  if (
    phase === 'done' &&
    !isExcludedRoute &&
    !suppressLauncher &&
    !kalaiIsOpen &&
    !voiceRecordingState?.isOpen &&
    !voiceRecordingState?.hasResult
  ) {
    return <YazhHelpLauncher onReplay={replayTour} />;
  }

  return null;
}
