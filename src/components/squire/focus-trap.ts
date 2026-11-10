import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** True when the element can take keyboard focus right now: not hidden, inert or inside a closed details. */
function reachable(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  // A closed <details> only exposes its own <summary>; every enclosing one has to be checked, because a
  // step's summary sits inside the investigation list, which is itself a <details>.
  for (
    let details = element.parentElement?.closest('details') ?? null;
    details;
    details = details.parentElement?.closest('details') ?? null
  ) {
    if (!details.open && !(element.tagName === 'SUMMARY' && element.parentElement === details))
      return false;
  }
  // CSS-hidden controls (for example a desktop-only button on a phone). Browsers without the API keep them.
  const visible = (element as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  return typeof visible === 'function' ? visible.call(element) : true;
}

/** The keyboard-focusable elements inside `root`, in document order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(reachable);
}

/**
 * Keeps Tab and Shift+Tab inside a modal dialog: past the last control focus wraps to the first and the
 * other way round. Returns true when it moved focus.
 */
export function trapTabKey(event: ReactKeyboardEvent<HTMLElement>, root: HTMLElement): boolean {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return false;
  const items = focusableWithin(root);
  if (items.length === 0) {
    event.preventDefault();
    root.focus();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = root.ownerDocument.activeElement;
  const inside = active instanceof HTMLElement && root.contains(active);
  if (event.shiftKey && (!inside || active === first || active === root)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
