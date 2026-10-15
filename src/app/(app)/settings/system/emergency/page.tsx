import { getControlActor } from '@/lib/auth-control/actor';
import { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { authenticationOrigin } from '@/lib/auth-control/origin';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import { Badge } from '@/components/ui/shadcn/badge';

export const dynamic = 'force-dynamic';
export default async function EmergencyAdministrationPage() {
  const actor = await getControlActor();
  const origin = await authenticationOrigin();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/settings/system?section=sso"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to SSO &amp; Authentication</span>
        </Link>
      </div>
      <SettingsPageHeader
        title="Emergency Access"
        description="Manage independent recovery passwords and hardware keys, verify custody, and rehearse authentication recovery."
        badge={<Badge variant="neutral">Independent recovery</Badge>}
      />
      <AuthenticationConsole
        initialData={await authenticationDashboard(actor, 'emergency')}
        callbackUrl={`${origin}/api/auth/callback/oidc`}
        testCallbackUrl={`${origin}/api/auth/oidc/test/callback`}
        emergencyOnly
      />
    </div>
  );
}
