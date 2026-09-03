'use client';

import { useState, useTransition } from 'react';
import { signOut } from 'next-auth/react';
import { revokeAllSessions } from '@/app/(app)/settings/security/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';
import {
  AlertCircle,
  CheckCircle2,
  Laptop,
  LogOut,
  ShieldCheck,
  Smartphone,
  Tablet,
} from 'lucide-react';
import type { ActiveSession } from '@/lib/active-sessions';

type Props = {
  tokenVersion?: number;
  sessions?: ActiveSession[];
};

function formatRelativeTime(isoString: string): { label: string; isActiveNow: boolean } {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    if (diffMs < 5 * 60 * 1000) {
      return { label: 'Active Now', isActiveNow: true };
    }
    const mins = Math.floor(diffMs / (60 * 1000));
    if (mins < 60) return { label: `Active ${mins}m ago`, isActiveNow: false };
    const hours = Math.floor(mins / 60);
    if (hours < 24) return { label: `Active ${hours}h ago`, isActiveNow: false };
    const days = Math.floor(hours / 24);
    return { label: `Active ${days}d ago`, isActiveNow: false };
  } catch {
    return { label: 'Recently Active', isActiveNow: false };
  }
}

function getClientDeviceInfo() {
  if (typeof window === 'undefined') {
    return { browser: 'Web Browser', os: 'Current Device', isMobile: false, isTablet: false };
  }
  const ua = navigator.userAgent;
  let browser = 'Web Browser';
  let os = 'Desktop';
  const isTablet = /iPad|tablet|(android(?!.*mobile))/i.test(ua);
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua) && !isTablet;

  if (ua.includes('Edg/') || ua.includes('Edge/')) browser = 'Microsoft Edge';
  else if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Google Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Apple Safari';
  else if (ua.includes('Firefox')) browser = 'Mozilla Firefox';

  if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux';
  else if (ua.includes('iPhone')) os = 'iOS';
  else if (ua.includes('iPad')) os = 'iPadOS';
  else if (ua.includes('Android')) os = 'Android';

  return { browser, os, isMobile, isTablet };
}

export default function ActiveSessionsSection({ tokenVersion = 1, sessions }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [deviceInfo] = useState(getClientDeviceInfo);

  const handleRevokeAll = () => {
    setError(null);
    startTransition(async () => {
      const result = await revokeAllSessions();
      if (result.error) {
        setError(result.error);
      } else if (result.success) {
        setSuccess(true);
        setTimeout(async () => {
          await signOut({ callbackUrl: '/login' });
        }, 1500);
      }
    });
  };

  // Fallback if no server sessions provided
  const displaySessions: ActiveSession[] =
    sessions && sessions.length > 0
      ? sessions
      : [
          {
            id: 'current-fallback',
            browser: deviceInfo.browser,
            os: deviceInfo.os,
            deviceType: deviceInfo.isTablet ? 'tablet' : deviceInfo.isMobile ? 'mobile' : 'desktop',
            ip: 'Current Connection',
            isCurrent: true,
            lastActive: new Date().toISOString(),
            tokenVersion,
          },
        ];

  return (
    <div className="space-y-4">
      {/* Session Cards List */}
      <div className="space-y-3">
        {displaySessions.map(session => {
          const timeInfo = formatRelativeTime(session.lastActive);
          const isLive = session.isCurrent || timeInfo.isActiveNow;

          return (
            <div
              key={session.id}
              className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border transition-all ${
                session.isCurrent
                  ? 'border-primary/30 bg-primary/5 shadow-sm'
                  : 'border-border bg-card hover:border-border/80'
              }`}
            >
              <div className="flex items-start sm:items-center gap-3.5">
                <div
                  className={`p-2.5 rounded-xl border shrink-0 ${
                    session.isCurrent
                      ? 'bg-primary/15 text-primary border-primary/25'
                      : 'bg-muted/80 text-muted-foreground border-border'
                  }`}
                >
                  {session.deviceType === 'mobile' ? (
                    <Smartphone className="h-5 w-5" />
                  ) : session.deviceType === 'tablet' ? (
                    <Tablet className="h-5 w-5" />
                  ) : (
                    <Laptop className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-sm text-foreground">
                      {session.browser} on {session.os}
                    </h4>
                    {session.isCurrent ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-semibold"
                      >
                        This Device
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-muted text-muted-foreground border-border/80 font-medium"
                      >
                        Connected Device
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {session.isCurrent ? 'Current authenticated session' : `IP: ${session.ip}`} ·
                    Security token v{session.tokenVersion || tokenVersion}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                {isLive ? (
                  <>
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      Active Now
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground font-medium">
                    {timeInfo.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription>
            All sessions revoked successfully. You will be redirected to the sign-in page...
          </AlertDescription>
        </Alert>
      )}

      {/* Revocation Trigger & Confirmation Modal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
          <span>If you suspect unauthorized access, revoke all sessions immediately.</span>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending || success}
              className="gap-2 shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              {isPending ? 'Revoking Sessions...' : 'Revoke All Sessions'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke All Active Sessions?</AlertDialogTitle>
              <AlertDialogDescription>
                This action will instantly invalidate your cryptographic session token across all
                browsers, mobile apps, and devices. You will be logged out everywhere immediately
                and must sign in again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRevokeAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
              >
                <LogOut className="h-4 w-4" />
                Revoke All Sessions
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
