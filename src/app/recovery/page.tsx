import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { EMERGENCY_COOKIE, getEmergencySession } from '@/lib/auth-control/emergency';
import { getControlActor } from '@/lib/auth-control/actor';
import { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { recoveryOrigin } from '@/lib/auth-control/origin';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import RecoveryActivity from '@/components/auth/RecoveryActivity';

export const dynamic = 'force-dynamic';
export default async function RecoveryPage() {
  const session = await getEmergencySession((await cookies()).get(EMERGENCY_COOKIE)?.value ?? '');
  if (!session) redirect('/login/emergency');
  const actor = await getControlActor();
  const data = await authenticationDashboard(actor);
  const origin = await recoveryOrigin();
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <RecoveryActivity />
      <h1 className="text-2xl font-semibold">Authentication recovery console</h1>
      <p>
        Repair SSO through a staged revision while the current policy stays enforced, manage
        emergency keys, or explicitly restore administrator access. This session cannot access
        incidents, responders, API keys or ordinary product administration.
      </p>
      <p className="text-sm">
        Session expires at {session.expiresAt.toISOString()}. Verify your key again before sensitive
        operations after five minutes.
      </p>
      <AuthenticationConsole
        initialData={data}
        callbackUrl={`${origin}/api/auth/callback/oidc`}
        testCallbackUrl={`${origin}/api/auth/oidc/test/callback`}
      />
    </main>
  );
}
