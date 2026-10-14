import EmergencyLogin from '@/components/auth/EmergencyLogin';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import Link from 'next/link';
import { Shield, KeyRound, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';

export const dynamic = 'force-dynamic';
export default async function EmergencyLoginPage() {
  const policy = await getAuthenticationPolicy();
  return (
    <main className="mx-auto max-w-lg space-y-6 p-6 sm:py-12">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 space-y-5">
        <div className="flex items-center justify-between">
          <div className="rounded-xl bg-primary/10 p-3">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <Badge variant="neutral">Independent recovery</Badge>
        </div>
        <h1 className="text-2xl font-semibold">Emergency Access</h1>
        <p>
          Use an enrolled independent identity to repair authentication. Emergency identities have
          access only to the recovery console.
        </p>
        <p className="text-sm text-muted-foreground flex items-start gap-2">
          <Clock aria-hidden="true" className="h-4 w-4 shrink-0 mt-0.5" />
          No Remember Me or trusted-device extension. Sessions expire after one hour or 15 minutes
          without deliberate interaction. Every attempt is audited; unauthenticated failures
          generate aggregated security alerts.
        </p>
        <EmergencyLogin legacyAvailable={Boolean(policy.legacyEmergencyEmail)} />
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <KeyRound className="h-4 w-4 shrink-0" />
          Use a separately held hardware key or an independently vaulted recovery password. Your
          organization’s SSO and synced passkeys cannot unlock recovery.
        </p>
      </div>
      <Link className="text-sm underline" href="/login">
        Return to normal sign-in
      </Link>
      <p>
        <a className="text-sm underline" href="https://opsknight.com/">
          OpsKnight
        </a>
      </p>
    </main>
  );
}
