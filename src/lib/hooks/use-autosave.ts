'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutosaveOptions<T> {
  data: T;
  onSave: (data: T) => Promise<{ success: boolean; error?: string }>;
  delay?: number;
  enabled?: boolean;
}

export function useAutosave<T>({
  data,
  onSave,
  delay = 500,
  enabled = true,
}: UseAutosaveOptions<T>) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const previousDataRef = useRef<T>(data);
  const isFirstRender = useRef(true);

  const save = useCallback(async () => {
    if (!enabled) return;

    setStatus('saving');
    setError(null);

    try {
      const result = await onSave(data);

      if (result.success) {
        setStatus('saved');
        // Reset to idle after 2 seconds
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        setStatus('error');
        setError(result.error || 'Failed to save');
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }, [data, onSave, enabled]);

  useEffect(() => {
    // Skip first render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      previousDataRef.current = data;
      return;
    }

    // Skip if data hasn't changed
    if (JSON.stringify(data) === JSON.stringify(previousDataRef.current)) {
      return;
    }

    previousDataRef.current = data;

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    if (enabled) {
      timeoutRef.current = setTimeout(() => {
        save();
      }, delay);
    }

    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [data, delay, enabled, save]);

  const retry = useCallback(() => {
    save();
  }, [save]);

  return {
    status,
    error,
    retry,
    isSaving: status === 'saving',
    isSaved: status === 'saved',
    hasError: status === 'error',
  };
}
