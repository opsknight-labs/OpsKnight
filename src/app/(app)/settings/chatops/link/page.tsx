import { linkMicrosoftTeamsAccount } from './actions';
import { requirePageAccess } from '@/lib/access/server';
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
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SettingsPageHeader
        title="Link Microsoft Teams"
        icon={MicrosoftTeamsLogo}
        description="Connect the Teams account that opened this link to your OpsKnight user, so actions you take in Teams are recorded as you."
        hideSearch
      />
      <SettingsSection
        title="Confirm the account link"
        description="Only continue if you opened this link from your own Microsoft Teams account."
        contentClassName="py-4"
      >
        <form action={linkMicrosoftTeamsAccount}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit">Link account</Button>
        </form>
      </SettingsSection>
    </div>
  );
}
