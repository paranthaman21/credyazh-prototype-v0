import { useCallback, useEffect, useState } from 'react';
import { TOUR_STEPS, getTourState, saveTourState, clearTourState } from '../config/tourSteps.js';

const ENABLED = import.meta.env.VITE_YAZH_TOUR_ENABLED !== 'false';

/**
 * useYazhTour — central state machine for the 7-step guided tour with persistence.
 *
 * Phases:
 *   'idle'         — initial mounting / determining action
 *   'offer'        — first-visit welcome screen
 *   'resume'       — refreshed during an unfinished tour, prompt to resume or start again
 *   'replay_offer' — opened from help launcher
 *   'running'      — actively stepping through the tour
 *   'done'         — tour is inactive; floating help launcher is displayed
 */
export function useYazhTour() {
  const [phase, setPhase] = useState('idle');
  const [stepIndex, setStepIndex] = useState(0);

  // Initialize tour state on mount from versioned storage
  useEffect(() => {
    if (!ENABLED) return;

    const saved = getTourState();

    if (saved.status === 'in_progress' && saved.stepIndex >= 1) {
      // User refreshed in the middle of a tour!
      setStepIndex(saved.stepIndex);
      const t = setTimeout(() => setPhase('resume'), 400);
      return () => clearTimeout(t);
    } else if (saved.status === 'not_started') {
      // First eligible visit: show welcome offer after app mount
      const t = setTimeout(() => setPhase('offer'), 800);
      return () => clearTimeout(t);
    } else {
      // 'completed' or 'dismissed': immediately show floating Help launcher
      setPhase('done');
    }
  }, []);

  const markComplete = useCallback(() => {
    saveTourState({ status: 'completed', stepIndex: TOUR_STEPS.length - 1 });
  }, []);

  const startTour = useCallback(() => {
    setStepIndex(1); // Jump directly to step 2 (Voice Entry) — welcome offer was already seen
    setPhase('running');
    saveTourState({ status: 'in_progress', stepIndex: 1 });
  }, []);

  const startTourAt = useCallback((idx = 1) => {
    const safeIdx = Math.max(0, Math.min(idx, TOUR_STEPS.length - 1));
    setStepIndex(safeIdx);
    setPhase('running');
    saveTourState({ status: 'in_progress', stepIndex: safeIdx });
  }, []);

  const resumeTour = useCallback(() => {
    const saved = getTourState();
    const resumeIndex = saved.stepIndex >= 1 ? saved.stepIndex : 1;
    startTourAt(resumeIndex);
  }, [startTourAt]);

  const restartTour = useCallback(() => {
    startTourAt(1);
  }, [startTourAt]);

  /** Advance one step; finish tour if already on last step */
  const handleNextStep = useCallback(() => {
    setStepIndex((prev) => {
      const next = prev + 1;
      if (next >= TOUR_STEPS.length) {
        markComplete();
        setPhase('done');
        return prev;
      }
      saveTourState({ status: 'in_progress', stepIndex: next });
      return next;
    });
  }, [markComplete]);

  /** Go back one step — never goes below 0 */
  const handlePreviousStep = useCallback(() => {
    setStepIndex((prev) => {
      const prevStep = Math.max(0, prev - 1);
      saveTourState({ status: 'in_progress', stepIndex: prevStep });
      return prevStep;
    });
  }, []);

  /**
   * Skip ONLY the current step — tour stays running.
   * If on the last step, treat as Finish.
   */
  const handleSkipStep = useCallback(() => {
    setStepIndex((prev) => {
      const next = prev + 1;
      if (next >= TOUR_STEPS.length) {
        markComplete();
        setPhase('done');
        return prev;
      }
      saveTourState({ status: 'in_progress', stepIndex: next });
      return next;
    });
  }, [markComplete]);

  /**
   * Exit the tour entirely — closes guide, keeps launcher visible.
   */
  const handleExitTour = useCallback(() => {
    // Preserve step index in dismissed state so launcher can offer resume if desired
    saveTourState({ status: 'dismissed', stepIndex });
    setPhase('done');
  }, [stepIndex]);

  /**
   * Dismiss resume/offer prompt without starting tour
   */
  const handleDismissPrompt = useCallback(() => {
    saveTourState({ status: 'dismissed', stepIndex });
    setPhase('done');
  }, [stepIndex]);

  /**
   * Finish the tour from the final step
   */
  const handleFinishTour = useCallback(() => {
    markComplete();
    setPhase('done');
  }, [markComplete]);

  /**
   * Replay tour from Help Launcher
   */
  const replayTour = useCallback(() => {
    const saved = getTourState();
    if (saved.stepIndex >= 1 && saved.status === 'in_progress') {
      setPhase('resume');
    } else {
      setPhase('replay_offer');
    }
  }, []);

  return {
    tourEnabled: ENABLED,
    phase,
    stepIndex,
    currentStep: TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0],
    totalSteps: TOUR_STEPS.length,
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
    markComplete,
  };
}
