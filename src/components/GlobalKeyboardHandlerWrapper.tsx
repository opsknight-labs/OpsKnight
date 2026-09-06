'use client';

import { useState, useEffect, useCallback } from 'react';
import GlobalKeyboardHandler from './GlobalKeyboardHandler';
import KeyboardShortcuts from './KeyboardShortcuts';

export default function GlobalKeyboardHandlerWrapper() {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    // Memoize toggle handlers to prevent unnecessary re-renders
    const handleToggle = useCallback(() => {
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
            <KeyboardShortcuts isOpen={shortcutsOpen} onClose={handleClose} />
        </>
    );
}

