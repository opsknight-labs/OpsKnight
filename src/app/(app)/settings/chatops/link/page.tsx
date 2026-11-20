import { linkMicrosoftTeamsAccount } from './actions';
import { requirePageAccess } from '@/lib/access/server';
import { describeMicrosoftTeamsIdentityChallenge } from '@/lib/microsoft-teams/identity';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { Button } from '@/components/ui/shadcn/button';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';

export default async function LinkChatOpsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  await requirePageAccess('/settings/chatops/link');
  const { token = '' } = await searchParams;
  const pending = await describeMicrosoftTeamsIdentityChallenge(token);
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Link Microsoft Teams"
        icon={MicrosoftTeamsLogo}
        description="Connect the Teams account that opened this link to your OpsKnight user, so actions you take in Teams are recorded as you."
        hideSearch
      />
      {pending ? (
        <SettingsSection
          title="Confirm the account link"
          description="This link will let the Microsoft Teams account below act as your signed-in OpsKnight user in Teams."
          contentClassName="space-y-4 py-4"
        >
          <dl className="rounded-md border p-4 text-sm">
            <dt className="text-muted-foreground">Teams account</dt>
            <dd className="font-medium">{pending.displayName || 'Unknown Teams user'}</dd>
            <dt className="mt-2 text-muted-foreground">Tenant</dt>
            <dd className="font-mono text-xs">{pending.tenantId}</dd>
          </dl>
          <p className="text-sm font-medium text-destructive">
            Only continue if this is your own Teams account and you opened this link yourself from
            Teams. Never complete a link someone else sent you.
          </p>
          <form action={linkMicrosoftTeamsAccount}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Link this Teams account</Button>
          </form>
        </SettingsSection>
      ) : (
        <SettingsSection title="Link unavailable" contentClassName="py-4">
          <p className="text-sm text-muted-foreground">
            This Microsoft Teams account-link request is invalid or expired. Start a new link from
            Teams.
          </p>
        </SettingsSection>
      )}
    </div>
  );
}
