import { useEffect, useRef, useState } from 'react';

/**
 * YazhTapIndicator — animated pointer that visually demonstrates tapping a button.
 *
 * Props:
 *   targetAttr  — data-tour value of the element to animate toward (e.g. 'tour-voice-btn')
 *   active      — boolean
 *
 * Safety: purely visual. Never programmatically clicks real buttons.
 * Respects prefers-reduced-motion.
 */
export default function YazhTapIndicator({ targetAttr, active }) {
  const [pos, setPos] = useState(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!targetAttr || !active) {
      setPos(null);
      return;
    }

    let isMounted = true;
    let attempts = 0;
    const maxAttempts = 25; // try for up to 2.5s (25 * 100ms)

    const updatePosition = () => {
      if (!isMounted) return false;
      const el = document.querySelector(`[data-tour="${targetAttr}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;

      setPos({
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
      });
      return true;
    };

    // Try immediately
    const foundImmediately = updatePosition();

    // Set up polling interval if not found immediately (waits for view navigation to complete)
    let interval = null;
    if (!foundImmediately) {
      interval = setInterval(() => {
        attempts++;
        if (updatePosition() || attempts >= maxAttempts) {
          clearInterval(interval);
        }
      }, 100);
    }

    // Scroll and resize tracking to keep indicator locked onto the element
    const onScrollOrResize = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (isMounted) updatePosition();
      });
    };

    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [targetAttr, active]);

  if (!active || !pos) return null;

  return (
    <div
      className="yazh-tap-indicator"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      aria-hidden="true"
    >
      {/* Ripple animation simulating finger press */}
      <div className="yazh-tap-ripple" />
      {/* Hand pointer */}
      <div className="yazh-tap-hand">👆</div>
      {/* Clean tap badge */}
      <div className="yazh-tap-badge">Tap</div>
    </div>
  );
}
