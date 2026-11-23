'use client';

import { useEffect, useRef } from 'react';
import { notify } from '@/lib/toast';

const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
]);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    (el.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((el as HTMLInputElement).type)) ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

/** Clicks a page control so permissions, confirmations and disabled states behave as with a mouse. */
function press(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el || (el as HTMLButtonElement).disabled || el.offsetParent === null) return false;
  // Radix tab triggers activate on mousedown, not click.
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  el.click();
  return true;
}

/**
 * Incident-page keys (listed in lib/keyboard-shortcuts): A acknowledge, R resolve, W write a note, T timeline,
 * S copy a summary. I (investigation) is owned by the insights host; N, C, ? and the G chords are global.
 */
export default function IncidentShortcuts({ summary }: { summary: string }) {
  const summaryRef = useRef(summary);
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  useEffect(() => {
    let chordStartedAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'g') {
        chordStartedAt = Date.now();
        return;
      }
      if (Date.now() - chordStartedAt < 1_000) return; // inside a G navigation chord
      let handled = false;
      if (key === 'a') handled = press('[data-incident-action="acknowledge"]');
      else if (key === 'r') handled = press('[data-incident-action="resolve"]');
      else if (key === 't') handled = press('[data-incident-tab="timeline"]');
      else if (key === 'w') {
        handled = press('[data-incident-tab="notes"]');
        if (handled)
          window.requestAnimationFrame(() =>
            document.querySelector<HTMLTextAreaElement>('[data-incident-note-input]')?.focus()
          );
      } else if (key === 's') {
        handled = true;
        void navigator.clipboard
          ?.writeText(summaryRef.current)
          .then(() => notify.success('Incident summary copied'))
          .catch(() => notify.error('Could not copy the summary'));
      }
      if (handled) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
