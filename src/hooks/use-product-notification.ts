'use client';

import { useCallback } from 'react';
import { notify } from '@/lib/toast';

type ToastType = 'success' | 'error' | 'warning' | 'info';

export function useToast() {
  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    switch (type) {
      case 'success':
        notify.success(message);
        break;
      case 'error':
        notify.error(message);
        break;
      case 'warning':
        notify.warning(message);
        break;
      case 'info':
        notify.info(message);
        break;
    }
  }, []);

  return { showToast };
}
