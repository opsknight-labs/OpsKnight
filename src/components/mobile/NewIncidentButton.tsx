'use client';

import Link from 'next/link';
import { haptics } from '@/lib/haptics';
import { Plus } from 'lucide-react';

export default function NewIncidentButton() {
  return (
    <Link
      href="/m/incidents/create"
      className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-slate-800 dark:bg-slate-700 p-4 text-white shadow-lg shadow-slate-900/10 active:scale-[0.98] transition-all font-semibold text-sm"
      onClick={() => haptics.impact('light')}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M12 5v14m-7-7h14" strokeLinecap="round" />
      </svg>
      New Incident
    </Link>
  );
}
