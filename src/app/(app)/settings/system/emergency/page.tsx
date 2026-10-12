import { getControlActor } from '@/lib/auth-control/actor';
import { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { authenticationOrigin } from '@/lib/auth-control/origin';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import Link from 'next/link';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import { Badge } from '@/components/ui/shadcn/badge';

export const dynamic = 'force-dynamic';
export default async function EmergencyAdministrationPage() {
  const actor = await getControlActor();
  const origin = await authenticationOrigin();
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Emergency Access"
        description="Manage independently held recovery keys, verify custody, and rehearse authentication recovery."
        badge={<Badge variant="neutral">Hardware keys</Badge>}
      />
      <Link href="/settings/system?section=sso" className="text-sm underline">
        SSO / Authentication
      </Link>
      <AuthenticationConsole
        initialData={await authenticationDashboard(actor, 'emergency')}
        callbackUrl={`${origin}/api/auth/callback/oidc`}
        testCallbackUrl={`${origin}/api/auth/oidc/test/callback`}
        emergencyOnly
      />
    </div>
  );
}
