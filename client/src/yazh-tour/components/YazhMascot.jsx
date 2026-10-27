import { useState } from 'react';
import { getAsset } from '../config/yazhAssets.js';

/**
 * YazhMascot — renders a Yazh PNG with safe fallback.
 * Props:
 *   assetKey   — key from YAZH_ASSETS (e.g. 'yazh-welcome')
 *   size       — 'large' | 'medium' | 'small'  (controls CSS class)
 *   className  — extra class names
 *   waving     — if true, applies the wave animation (welcome screen only)
 */
export default function YazhMascot({ assetKey, size = 'medium', className = '', waving = false }) {
  const [imgError, setImgError] = useState(false);
  const asset = getAsset(assetKey);

  const sizeClass = size === 'large'
    ? 'yazh-welcome-mascot'
    : size === 'small'
      ? 'yazh-tooltip-mascot yazh-size-small'
      : 'yazh-tooltip-mascot';

  const waveClass = size === 'large' && !waving ? 'no-wave' : '';

  if (imgError) {
    return (
      <div
        className={`yazh-mascot-fallback ${className}`}
        role="img"
        aria-label={asset.alt}
        style={{
          fontSize: size === 'large' ? 64 : size === 'medium' ? 48 : 32,
          textAlign: 'center',
          userSelect: 'none',
        }}
      >
        🎭
      </div>
    );
  }

  return (
    <img
      src={asset.src}
      alt={asset.alt}
      className={[sizeClass, waveClass, className].filter(Boolean).join(' ')}
      onError={() => setImgError(true)}
      draggable={false}
    />
  );
}
