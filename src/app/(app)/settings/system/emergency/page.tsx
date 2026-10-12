import { getControlActor } from '@/lib/auth-control/actor';
import { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { authenticationOrigin } from '@/lib/auth-control/origin';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export default async function EmergencyAdministrationPage() {
  const actor = await getControlActor();
  const origin = await authenticationOrigin();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Emergency Access</h1>
      <Link href="/settings/system?section=sso" className="text-sm underline">
        SSO / Authentication
      </Link>
      <AuthenticationConsole
        initialData={await authenticationDashboard(actor)}
        callbackUrl={`${origin}/api/auth/callback/oidc`}
        testCallbackUrl={`${origin}/api/auth/oidc/test/callback`}
        emergencyOnly
      />
    </div>
  );
}
