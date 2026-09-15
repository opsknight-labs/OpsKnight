'use client';

import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';
import { promiseWithTimeout } from '@/lib/client-timeout';

type Props = {
  icon: ReactNode;
  label: string;
  description: string;
  tone: 'red' | 'slate' | 'blue' | 'teal' | 'amber' | 'green';
};

export default function MobileSignOutButton({ icon, label, description }: Props) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const callbackUrl = '/m/login?callbackUrl=/m';
    try {
      await promiseWithTimeout(purgeBrowserAuthCaches(), 5_000).catch(() => {});
      await promiseWithTimeout(signOut({ callbackUrl }), 8_000);
    } catch {
      router.push(callbackUrl);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-destructive transition-colors hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{isSigningOut ? 'Signing out…' : label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
