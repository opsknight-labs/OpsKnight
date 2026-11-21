'use client';

import { useState } from 'react';
import { updateBundlePreference } from '@/app/(app)/settings/noise-actions';
import { notify } from '@/lib/toast';

/** Optimistic toggle for the bundling opt-in, shared by the desktop section and the mobile card. */
export function useBundlePreference(initial: boolean) {
  const [enabled, setEnabled] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function set(next: boolean) {
    setEnabled(next);
    setSaving(true);
    const result = await updateBundlePreference(next).catch(() => ({
      success: false,
      error: 'Unable to save the bundling preference.',
    }));
    setSaving(false);
    if (!result.success) {
      setEnabled(!next);
      notify.error(result.error ?? 'Unable to save the bundling preference.');
    }
  }

  return { enabled, saving, set };
}
