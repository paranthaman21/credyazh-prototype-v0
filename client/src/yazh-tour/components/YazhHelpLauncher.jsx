import { useState } from 'react';
import { getAsset } from '../config/yazhAssets.js';

/**
 * YazhHelpLauncher — the floating mini-button shown after the tour is dismissed.
 * Allows the user to replay the tour at any time.
 * Positioned above the bottom nav bar.
 */
export default function YazhHelpLauncher({ onReplay }) {
  const [imgError, setImgError] = useState(false);
  const asset = getAsset('yazh-welcome');

  return (
    <button
      id="yazh-help-launcher"
      className="yazh-help-launcher"
      onClick={onReplay}
      aria-label="Replay Yazh guided tour"
      title="Replay the product tour"
    >
      {imgError ? (
        <span style={{ fontSize: 24 }}>🎭</span>
      ) : (
        <img
          src={asset.src}
          alt="Yazh"
          className="yazh-help-launcher-img"
          onError={() => setImgError(true)}
          draggable={false}
        />
      )}
      <span className="yazh-help-launcher-text">
        Tour Guide
        <small>Tap to replay</small>
      </span>
    </button>
  );
}
