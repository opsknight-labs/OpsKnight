'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import { GLOBAL_NAVIGATION_SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { matchesRouteSegment } from '@/lib/navigation/active-nav';

/** Text entry: keys belong to the field, not to shortcuts. */
function isTypingTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

/** The open dialog the key event comes from, if any; dialogs own the keyboard. */
function closestDialog(target: HTMLElement | null): Element | null {
  return target?.closest?.('[role="dialog"], [role="alertdialog"]') ?? null;
}

type KeyboardHandlerProps = {
  onShortcutsToggle: () => void;
};

export default function GlobalKeyboardHandler({ onShortcutsToggle }: KeyboardHandlerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { openCreateIncident } = useCreateIncidentModal();
  const [gPressed, setGPressed] = useState(false);

  // Use refs to avoid re-attaching event listeners when state/callbacks change
  const gPressedRef = useRef(gPressed);
  const pathnameRef = useRef(pathname);
  const onShortcutsToggleRef = useRef(onShortcutsToggle);
  const openCreateIncidentRef = useRef(openCreateIncident);

  // Keep refs in sync
  useEffect(() => {
    gPressedRef.current = gPressed;
  }, [gPressed]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    onShortcutsToggleRef.current = onShortcutsToggle;
  }, [onShortcutsToggle]);

  useEffect(() => {
    openCreateIncidentRef.current = openCreateIncident;
  }, [openCreateIncident]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (isTypingTarget(target)) return;
      const dialog = closestDialog(target);

      // ? toggles the shortcuts sheet from anywhere, including mid G-sequence and from inside
      // the sheet itself, but not over another dialog.
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (dialog && !dialog.hasAttribute('data-shortcuts-sheet')) return;
        e.preventDefault();
        if (gPressedRef.current) setGPressed(false);
        onShortcutsToggleRef.current();
        return;
      }
      if (dialog) return;

      // G key for navigation (G+D, G+I, etc.)
      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setGPressed(true);
        return;
      }

      // If G was pressed, handle navigation
      if (gPressedRef.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        const destination = GLOBAL_NAVIGATION_SHORTCUTS.find(item => item.key === key);
        if (destination) {
          e.preventDefault();
          router.push(destination.href);
        }
        setGPressed(false);
        return;
      }

      // Reset G state if another key is pressed
      if (gPressedRef.current) {
        setGPressed(false);
      }

      // C or Cmd+C / Ctrl+C for Quick Create Menu
      if (e.key.toLowerCase() === 'c' && !e.altKey) {
        if (e.metaKey || e.ctrlKey) {
          // If Cmd/Ctrl is held, only trigger if no text is currently selected
          const selectedText = window.getSelection()?.toString();
          if (!selectedText || selectedText.trim().length === 0) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('openQuickCreate'));
          }
        } else {
          // Plain 'c' without modifiers
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('openQuickCreate'));
        }
      }

      // N key for new incident (when on incidents page)
      if (
        e.key.toLowerCase() === 'n' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        matchesRouteSegment(pathnameRef.current ?? '', '/incidents')
      ) {
        e.preventDefault();
        openCreateIncidentRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [router]); // Only router is needed as dependency since we use refs for others

  // Reset G state after timeout
  useEffect(() => {
    if (gPressed) {
      const timeout = setTimeout(() => setGPressed(false), 1000);
      return () => clearTimeout(timeout);
    }
  }, [gPressed]);

  return null;
}
