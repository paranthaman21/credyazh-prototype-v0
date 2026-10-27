// ─────────────────────────────────────────────────────────────
// Yazh Asset Registry
// Maps asset name → public URL and optional fallback alt text
// ─────────────────────────────────────────────────────────────

const BASE = '/assets/yazh';

export const YAZH_ASSETS = {
  'yazh-welcome':    { src: `${BASE}/yazh-welcome.png`,    alt: 'Yazh welcoming you' },
  'yazh-explaining': { src: `${BASE}/yazh-explaining.png`, alt: 'Yazh explaining a feature' },
  'yazh-pointing':   { src: `${BASE}/yazh-pointing.png`,   alt: 'Yazh pointing to a feature' },
  'yazh-listening':  { src: `${BASE}/yazh-listening.png`,  alt: 'Yazh listening' },
  'yazh-thinking':   { src: `${BASE}/yazh-thinking.png`,   alt: 'Yazh thinking' },
  'yazh-success':    { src: `${BASE}/yazh-success.png`,    alt: 'Yazh celebrating success' },
  'yazh-warning':    { src: `${BASE}/yazh-warning.png`,    alt: 'Yazh warning' },
  'yazh-goodbye':    { src: `${BASE}/yazh-goodbye.png`,    alt: 'Yazh waving goodbye' },
};

/**
 * Returns { src, alt } for an asset key.
 * Falls back to yazh-welcome on unknown keys.
 */
export function getAsset(key) {
  return YAZH_ASSETS[key] ?? YAZH_ASSETS['yazh-welcome'];
}
