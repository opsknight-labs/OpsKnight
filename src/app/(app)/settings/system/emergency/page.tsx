import { getControlActor } from '@/lib/auth-control/actor';
import { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { authenticationOrigin } from '@/lib/auth-control/origin';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import Link from 'next/link';
import { ArrowLeft, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { pageHeaderActionClass, pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
import { cn } from '@/lib/utils';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export default async function EmergencyAdministrationPage() {
  await requirePageAccess('/settings/system/emergency');
  const actor = await getControlActor();
  const origin = await authenticationOrigin();
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Emergency Access"
        icon={LifeBuoy}
        description="Manage independent recovery passwords and hardware keys, verify custody, and rehearse authentication recovery."
        badges={<span className={pageHeaderBadgeClass}>Independent recovery</span>}
        secondaryActions={
          <Button
            asChild
            variant="outline"
            size="sm"
            className={cn('gap-2', pageHeaderActionClass)}
          >
            <Link href="/settings/system?section=sso">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              SSO &amp; authentication
            </Link>
          </Button>
        }
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
