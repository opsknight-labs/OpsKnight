import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { EMERGENCY_COOKIE, getEmergencySession } from '@/lib/auth-control/emergency';
import { getControlActor } from '@/lib/auth-control/actor';
import { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { recoveryOrigin } from '@/lib/auth-control/origin';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import RecoveryActivity from '@/components/auth/RecoveryActivity';
import RecoveryHeader from '@/components/auth/RecoveryHeader';
import { KeyRound, Lock, Clock, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';

export const dynamic = 'force-dynamic';

export default async function RecoveryPage() {
  const session = await getEmergencySession((await cookies()).get(EMERGENCY_COOKIE)?.value ?? '');
  if (!session) redirect('/login/emergency');
  const actor = await getControlActor();
  const data = await authenticationDashboard(actor);
  const origin = await recoveryOrigin();

  const accountName = session.account?.displayName ?? 'Emergency Administrator';

  return (
    <div className="min-h-screen bg-muted/20">
      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <RecoveryActivity />

        {/* Top Header Bar */}
        <RecoveryHeader accountName={accountName} expiresAtIso={session.expiresAt.toISOString()} />

        {/* Hero Context Card */}
        <div className="rounded-2xl border bg-card p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                <KeyRound className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                    Authentication recovery console
                  </h1>
                  <Badge variant="warning" className="text-xs font-semibold">
                    Recovery Mode
                  </Badge>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-3xl">
                  Use this isolated console to repair Identity Provider configurations through
                  staged revisions, rotate recovery credentials, or restore emergency administrator
                  password access. Active sign-in policies remain enforced during your session.
                </p>
              </div>
            </div>
          </div>

          {/* Three Operational Callout Chips */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-border/60">
            <div className="flex items-start gap-2.5 p-3 rounded-xl border bg-muted/20">
              <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Strict Isolation</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Operational incidents, alerts, responders, and production API keys remain securely
                  inaccessible.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-xl border bg-muted/20">
              <Lock className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Freshness Protection</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Sensitive changes require verifying your recovery credential again after five
                  minutes.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-xl border bg-muted/20">
              <Clock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Inactivity Timeout</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Sessions automatically terminate after 15 minutes of inactivity or at hard expiry.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Authentication Control Workspace */}
        <AuthenticationConsole
          initialData={data}
          callbackUrl={`${origin}/api/auth/callback/oidc`}
          testCallbackUrl={`${origin}/api/auth/oidc/test/callback`}
        />
      </main>
    </div>
  );
}
