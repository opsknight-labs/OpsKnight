'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { LogOut, Clock, UserCheck, Loader2 } from 'lucide-react';
import AuthBrand from './AuthBrand';

export type RecoveryHeaderProps = {
  accountName: string;
  expiresAtIso: string;
};

export default function RecoveryHeader({ accountName, expiresAtIso }: RecoveryHeaderProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const formattedExpiry = (() => {
    try {
      const date = new Date(expiresAtIso);
      return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(date);
    } catch {
      return expiresAtIso;
    }
  })();

  const handleSignout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch {
      // Ignore network failures and redirect to login
    } finally {
      router.replace('/login/emergency');
    }
  };

  return (
    <header className="rounded-2xl border bg-card/95 backdrop-blur-md p-4 sm:p-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Brand & Identity */}
        <div className="flex items-center gap-3.5 min-w-0">
          <AuthBrand compact />
          <div className="h-5 w-px bg-border/80 hidden sm:block" />
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Emergency Console
            </span>
            <Badge
              variant="outline"
              className="border-status-elevated/30 bg-status-elevated/10 text-status-elevated-deep text-2xs font-semibold flex items-center gap-1.5"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-elevated opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-status-elevated"></span>
              </span>
              Isolated Session
            </Badge>
          </div>
        </div>

        {/* Status Chips & Signout Action */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-muted/30 text-xs text-foreground/90 font-medium">
            <UserCheck className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate max-w-[150px]">{accountName}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-muted/30 text-xs text-muted-foreground font-medium">
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>Expires at {formattedExpiry}</span>
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={loggingOut}
            onClick={handleSignout}
            className="h-9 px-3 gap-1.5 text-xs font-medium border-border/80 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
          >
            {loggingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
