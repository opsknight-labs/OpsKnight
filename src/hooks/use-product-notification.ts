'use client';

import { useCallback } from 'react';
import { notify } from '@/lib/toast';

type ToastType = 'success' | 'error' | 'warning' | 'info';

function toastText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  return String(message ?? '');
}

export function useToast() {
  const showToast = useCallback((message: unknown, type: ToastType = 'info') => {
    if (type === 'error') {
      // Keep structured error payloads intact so notify.error() can consume
      // stable code/action/retryable/fields metadata instead of only a string.
      notify.error(message);
      return;
    }

    const text = toastText(message);
    switch (type) {
      case 'success':
        notify.success(text);
        break;
      case 'warning':
        notify.warning(text);
        break;
      case 'info':
        notify.info(text);
        break;
    }
  }, []);

  return { showToast };
}
