import SettingsHeader from '@/components/settings/SettingsHeader';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import { getUserPermissions } from '@/lib/rbac';

type Props = {
  title: string;
  description?: string;
  learnMoreHref?: string;
  learnMoreLabel?: string;
  backHref?: string;
  backLabel?: string;
  currentPageId?: string;
  children: React.ReactNode;
};

export default async function SettingsPage({
  title,
  description,
  learnMoreHref,
  learnMoreLabel = 'Learn more',
  backHref,
  backLabel,
  currentPageId,
  children,
}: Props) {
  const permissions = currentPageId ? await getUserPermissions() : null;

  return (
    <div className="settings-page-v2" data-settings-page={currentPageId || 'overview'}>
      {currentPageId && permissions && (
        <SettingsPageHeader
          currentPageId={currentPageId}
          isAdmin={permissions.isAdmin}
          isAuditor={permissions.isAuditor}
          isResponderOrAbove={permissions.isResponderOrAbove}
        />
      )}
      <SettingsHeader
        title={title}
        description={description}
        learnMoreHref={learnMoreHref}
        learnMoreLabel={learnMoreLabel}
        backHref={backHref}
        backLabel={backLabel}
      />
      <div className="settings-page-content">{children}</div>
    </div>
  );
}
