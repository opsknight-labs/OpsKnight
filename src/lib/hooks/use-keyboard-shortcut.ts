'use client';

import { useEffect, useCallback } from 'react';

/**
 * Keyboard shortcut configuration
 */
export interface ShortcutConfig {
  /** The key to listen for (lowercase, e.g., 'k', 's', 'escape') */
  key: string;
  /** Whether Ctrl (Windows/Linux) or Cmd (Mac) is required */
  ctrl?: boolean;
  /** Whether Shift is required */
  shift?: boolean;
  /** Whether Alt is required */
  alt?: boolean;
  /** Callback to execute when shortcut is triggered */
  callback: () => void;
  /** Whether to prevent default browser behavior */
  preventDefault?: boolean;
  /** Description of the shortcut (for legend display) */
  description?: string;
}

/**
 * Hook to register a single keyboard shortcut
 *
 * @example
 * // Simple shortcut
 * useKeyboardShortcut({
 *   key: 'k',
 *   ctrl: true,
 *   callback: () => setOpen(true),
 *   description: 'Open command palette',
 * });
 *
 * @example
 * // Escape key
 * useKeyboardShortcut({
 *   key: 'Escape',
 *   callback: () => setOpen(false),
 * });
 */
export function useKeyboardShortcut(config: ShortcutConfig) {
  const { key, ctrl, shift, alt, callback, preventDefault = true } = config;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      const target = event.target as HTMLElement;
      const isTyping =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Allow Escape to work even in inputs
      if (isTyping && key.toLowerCase() !== 'escape') {
        return;
      }

      // Check modifiers
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      if (ctrl && !ctrlOrMeta) return;
      if (!ctrl && ctrlOrMeta && key.toLowerCase() !== 'escape') return;
      if (shift && !event.shiftKey) return;
      if (!shift && event.shiftKey) return;
      if (alt && !event.altKey) return;
      if (!alt && event.altKey) return;

      // Check key match (case-insensitive)
      if (event.key.toLowerCase() !== key.toLowerCase()) return;

      // Execute callback
      if (preventDefault) {
        event.preventDefault();
      }
      callback();
    },
    [key, ctrl, shift, alt, callback, preventDefault]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * Hook to register multiple keyboard shortcuts at once
 */
export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      for (const shortcut of shortcuts) {
        const { key, ctrl, shift, alt, callback, preventDefault = true } = shortcut;

        // Allow Escape to work in inputs
        if (isTyping && key.toLowerCase() !== 'escape') {
          continue;
        }

        const ctrlOrMeta = event.ctrlKey || event.metaKey;
        if (ctrl && !ctrlOrMeta) continue;
        if (!ctrl && ctrlOrMeta && key.toLowerCase() !== 'escape') continue;
        if (shift && !event.shiftKey) continue;
        if (!shift && event.shiftKey) continue;
        if (alt && !event.altKey) continue;
        if (!alt && event.altKey) continue;

        if (event.key.toLowerCase() === key.toLowerCase()) {
          if (preventDefault) {
            event.preventDefault();
          }
          callback();
          break;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * Hook for sequence shortcuts (e.g., g then p for "Go to Profile")
 */
export function useSequenceShortcut(sequence: string[], callback: () => void, timeoutMs = 1000) {
  useEffect(() => {
    let buffer: string[] = [];
    let timeoutId: NodeJS.Timeout;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (isTyping) return;

      // Clear timeout and add key to buffer
      clearTimeout(timeoutId);
      buffer.push(event.key.toLowerCase());

      // Check if buffer matches sequence
      if (buffer.length === sequence.length) {
        const matches = buffer.every((key, index) => key === sequence[index].toLowerCase());
        if (matches) {
          event.preventDefault();
          callback();
        }
        buffer = [];
      } else if (buffer.length > sequence.length) {
        buffer = [event.key.toLowerCase()];
      }

      // Reset buffer after timeout
      timeoutId = setTimeout(() => {
        buffer = [];
      }, timeoutMs);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeoutId);
    };
  }, [sequence, callback, timeoutMs]);
}
