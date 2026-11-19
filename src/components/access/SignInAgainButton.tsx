'use client';

import { signOut } from 'next-auth/react';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';

/** Ends the session and returns to `returnPath` after a fresh sign-in (step-up). */
export function signInAgain(returnPath: string) {
  const safe = returnPath.startsWith('/') && !returnPath.startsWith('//') ? returnPath : '/';
  void signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(safe)}` });
}

export default function SignInAgainButton({
  returnPath,
  label = 'Sign in again',
}: {
  returnPath: string;
  label?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={() => signInAgain(returnPath)}
    >
      <LogIn className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );
}
