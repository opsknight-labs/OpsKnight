'use client';

import Link from 'next/link';
import { haptics } from '@/lib/haptics';
import { Plus } from 'lucide-react';

export default function NewIncidentButton() {
  return (
    <Link
      href="/m/incidents/create"
      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-primary/80"
      onClick={() => haptics.impact('light')}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      <span>New incident</span>
    </Link>
  );
}
