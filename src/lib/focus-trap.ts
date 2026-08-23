const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function getFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    element => !element.hasAttribute('disabled') && !element.getAttribute('aria-hidden')
  );
}

export function trapFocus(root: HTMLElement, onEscape?: () => void) {
  const previouslyFocused =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  const focusFirst = () => {
    const focusable = getFocusableElements(root);
    (focusable[0] ?? root).focus();
  };

  focusFirst();

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onEscape?.();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements(root);
    if (focusable.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first || document.activeElement === root) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  root.addEventListener('keydown', handleKeyDown);
  return () => {
    root.removeEventListener('keydown', handleKeyDown);
    try {
      previouslyFocused?.focus();
    } catch {
      // Ignore if element is unmounted
    }
  };
}
