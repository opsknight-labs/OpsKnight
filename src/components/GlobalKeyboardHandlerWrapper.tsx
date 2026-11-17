'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import GlobalKeyboardHandler from './GlobalKeyboardHandler';

const KeyboardShortcuts = dynamic(() => import('./KeyboardShortcuts'), { ssr: false });

export default function GlobalKeyboardHandlerWrapper() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Stay mounted after the first open so the sheet can animate out and restore focus.
  const [hasOpened, setHasOpened] = useState(false);

  // Memoize toggle handlers to prevent unnecessary re-renders
  const handleToggle = useCallback(() => {
    setHasOpened(true);
    setShortcutsOpen(prev => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setShortcutsOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener('toggleKeyboardShortcuts', handleToggle);
    return () => window.removeEventListener('toggleKeyboardShortcuts', handleToggle);
  }, [handleToggle]);

  return (
    <>
      <GlobalKeyboardHandler onShortcutsToggle={handleToggle} />
      {hasOpened && <KeyboardShortcuts isOpen={shortcutsOpen} onClose={handleClose} />}
    </>
  );
}
