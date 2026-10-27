/**
 * tourStorage.js — Versioned, resilient tour state persistence for Yazh.
 *
 * STRICT SAFETY RULES:
 * 1. ONLY stores tour progress status and step index.
 * 2. NEVER stores customer names, balances, amounts, transactions, or ledger data.
 * 3. Gracefully handles disabled / restricted localStorage without throwing or breaking the app.
 * 4. Supports legacy 'credyazh_yazh_tour_v1' migration.
 */

export const TOUR_STORAGE_KEY = 'credyazh_yazh_tour_state_v1';
export const LEGACY_STORAGE_KEY = 'credyazh_yazh_tour_v1';

/**
 * Check if window.localStorage is accessible and writable.
 */
export function isLocalStorageAvailable() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const testKey = '__credyazh_storage_probe__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * In-memory fallback if localStorage is disabled or throws.
 */
let inMemoryState = null;

/**
 * Retrieve saved tour progress.
 * @returns {{ version: number, status: 'not_started'|'in_progress'|'completed'|'dismissed', stepIndex: number }}
 */
export function getTourState() {
  try {
    if (!isLocalStorageAvailable()) {
      return inMemoryState || { version: 1, status: 'not_started', stepIndex: 0 };
    }

    const raw = window.localStorage.getItem(TOUR_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const validStatuses = ['not_started', 'in_progress', 'completed', 'dismissed'];
        const status = validStatuses.includes(parsed.status) ? parsed.status : 'not_started';
        const stepIndex = typeof parsed.stepIndex === 'number' && parsed.stepIndex >= 0 ? parsed.stepIndex : 0;
        return { version: 1, status, stepIndex };
      }
    }

    // Check legacy key for existing users
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === 'v1' || legacy === 'true' || legacy === 'done') {
      return { version: 1, status: 'completed', stepIndex: 0 };
    }
  } catch (err) {
    console.warn('[YazhTour] Failed to read tour state from storage:', err);
  }

  return inMemoryState || { version: 1, status: 'not_started', stepIndex: 0 };
}

/**
 * Save tour progress to versioned storage.
 * @param {{ status: 'not_started'|'in_progress'|'completed'|'dismissed', stepIndex?: number }} param0
 */
export function saveTourState({ status, stepIndex = 0 }) {
  const validStatuses = ['not_started', 'in_progress', 'completed', 'dismissed'];
  const safeStatus = validStatuses.includes(status) ? status : 'not_started';
  const safeStep = typeof stepIndex === 'number' && stepIndex >= 0 ? Math.floor(stepIndex) : 0;

  const payload = {
    version: 1,
    status: safeStatus,
    stepIndex: safeStep,
  };

  inMemoryState = payload;

  try {
    if (!isLocalStorageAvailable()) return;
    window.localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[YazhTour] Failed to save tour state to storage:', err);
  }
}

/**
 * Reset tour state (e.g. for replaying from scratch).
 */
export function clearTourState() {
  inMemoryState = { version: 1, status: 'not_started', stepIndex: 0 };
  try {
    if (!isLocalStorageAvailable()) return;
    window.localStorage.removeItem(TOUR_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (err) {
    console.warn('[YazhTour] Failed to clear tour state from storage:', err);
  }
}
