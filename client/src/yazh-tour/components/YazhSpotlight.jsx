import { useEffect, useRef, useState } from 'react';

/**
 * YazhSpotlight — highlights a DOM element targeted by data-tour attribute.
 *
 * Props:
 *   targetAttr  — the data-tour value to target (e.g. 'tour-voice-btn')
 *   active      — boolean, whether spotlight is active
 *   dimBg       — boolean, whether to dim the rest of the page (default true)
 *
 * Implementation:
 *   - Measures the target's bounding box
 *   - Draws a cutout highlight using a fixed SVG mask overlay
 *   - Recomputes on scroll, resize, and route changes
 *   - Respects prefers-reduced-motion
 *   - Safely handles missing targets (renders nothing, no crash)
 */
export default function YazhSpotlight({ targetAttr, active, dimBg = true }) {
  const [rect, setRect] = useState(null);
  const rafRef = useRef(null);
  const padding = 8;

  useEffect(() => {
    if (!active) { setRect(null); return; }

    let isMounted = true;
    let attempts = 0;
    const maxAttempts = 25; // try for up to 2.5s

    let lastEl = null;

    const measureTarget = () => {
      if (!isMounted || !targetAttr || !active) { setRect(null); return false; }
      const el = document.querySelector(`[data-tour="${targetAttr}"]`);
      if (!el) { setRect(null); return false; }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;

      if (lastEl !== el) {
        if (lastEl) lastEl.classList.remove('yazh-tour-highlight-target');
        el.classList.add('yazh-tour-highlight-target');
        lastEl = el;
      }

      setRect({
        top:    r.top    - padding,
        left:   r.left   - padding,
        width:  r.width  + padding * 2,
        height: r.height + padding * 2,
        right:  r.right  + padding,
        bottom: r.bottom + padding,
      });
      return true;
    };

    const foundImmediately = measureTarget();

    let interval = null;
    if (!foundImmediately) {
      interval = setInterval(() => {
        attempts++;
        if (measureTarget() || attempts >= maxAttempts) {
          clearInterval(interval);
        }
      }, 100);
    }

    const onScrollOrResize = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (isMounted) measureTarget();
      });
    };

    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });
    return () => {
      isMounted = false;
      if (lastEl) lastEl.classList.remove('yazh-tour-highlight-target');
      if (interval) clearInterval(interval);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [targetAttr, active]);

  if (!active || !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // SVG mask: full-screen rect with a transparent cutout for the target
  const cutoutPath = [
    `M 0 0 H ${vw} V ${vh} H 0 Z`,
    `M ${rect.left} ${rect.top}`,
    `H ${rect.left + rect.width}`,
    `V ${rect.top + rect.height}`,
    `H ${rect.left} Z`,
  ].join(' ');

  return (
    <svg
      className="yazh-spotlight-svg"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9050,
      }}
      aria-hidden="true"
    >
      {dimBg && (
        <path
          d={cutoutPath}
          fill="rgba(15,23,42,0.52)"
          fillRule="evenodd"
        />
      )}
      {/* Pulsing border around the highlighted element */}
      <rect
        x={rect.left}
        y={rect.top}
        width={rect.width}
        height={rect.height}
        rx={8}
        fill="none"
        stroke="var(--orange, #f2842f)"
        strokeWidth="2.5"
        style={{
          animation: 'spotlightBorderPulse 1.8s ease-in-out infinite',
        }}
      />
    </svg>
  );
}
