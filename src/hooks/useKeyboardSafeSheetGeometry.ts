'use client';

import { useEffect, useState } from 'react';

export type KeyboardSafeSheetGeometry = {
  /** Cap for the sheet's max-height, in px. Null while unavailable (falls back to CSS). */
  maxHeight: number | null;
  /** How far to lift a `fixed bottom-0` sheet so it clears the on-screen keyboard, in px. */
  bottomOffset: number;
};

/**
 * Shared keyboard/safe-area contract for bottom sheets: tracks
 * `window.visualViewport` while `open` and returns the geometry a
 * `fixed inset-x-0 bottom-0` sheet needs so it never extends behind the
 * on-screen keyboard and never floors itself taller than what's actually
 * visible. Extracted from MobileQuickSwitcher so future sheets (filters,
 * action sheets, mobile forms) don't each reinvent this.
 */
export function useKeyboardSafeSheetGeometry(open: boolean): KeyboardSafeSheetGeometry {
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const [bottomOffset, setBottomOffset] = useState(0);

  useEffect(() => {
    if (!open || typeof window === 'undefined' || !window.visualViewport) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets geometry when the sheet closes or the viewport API is unavailable
      setMaxHeight(null);
      setBottomOffset(0);
      return;
    }
    const viewport = window.visualViewport;
    const update = () => {
      // The viewport itself is authoritative: never floor this above what is
      // actually visible, or the sheet can extend behind the keyboard.
      setMaxHeight(Math.max(0, Math.round(viewport.height) - 12));
      // `fixed bottom-0` anchors to the layout viewport, which does not move
      // when the keyboard opens. Lift the sheet by however much the visual
      // viewport has been pushed up/shrunk so it stays above the keyboard.
      setBottomOffset(
        Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
      );
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [open]);

  return { maxHeight, bottomOffset };
}
