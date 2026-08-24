'use client';

import { useCallback } from 'react';
import { notify } from '@/lib/toast';

type ToastType = 'success' | 'error' | 'warning' | 'info';

export function useToast() {
  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    notify[type](message);
  }, []);

  return { showToast };
}
