'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';

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
      // Ignore if typing in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // G key for navigation (G+D, G+I, etc.)
      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setGPressed(true);
        return;
      }

      // If G was pressed, handle navigation
      if (gPressedRef.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        switch (key) {
          case 'd':
            e.preventDefault();
            router.push('/');
            setGPressed(false);
            break;
          case 'i':
            e.preventDefault();
            router.push('/incidents');
            setGPressed(false);
            break;
          case 's':
            e.preventDefault();
            router.push('/services');
            setGPressed(false);
            break;
          case 't':
            e.preventDefault();
            router.push('/teams');
            setGPressed(false);
            break;
          case 'u':
            e.preventDefault();
            router.push('/users');
            setGPressed(false);
            break;
          case 'c':
            e.preventDefault();
            router.push('/schedules');
            setGPressed(false);
            break;
          case 'p':
            e.preventDefault();
            router.push('/policies');
            setGPressed(false);
            break;
          case 'a':
            e.preventDefault();
            router.push('/analytics');
            setGPressed(false);
            break;
          default:
            setGPressed(false);
        }
        return;
      }

      // Reset G state if another key is pressed
      if (gPressedRef.current) {
        setGPressed(false);
      }

      // ? key for shortcuts
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onShortcutsToggleRef.current();
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
        pathnameRef.current?.startsWith('/incidents')
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
