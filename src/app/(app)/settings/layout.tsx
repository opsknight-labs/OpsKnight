import { getUserPermissions } from '@/lib/rbac';
import SettingsShell from '@/components/settings/SettingsShell';

import SettingsZoomWrapper from '@/components/SettingsZoomWrapper';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const permissions = await getUserPermissions();

  return (
    <SettingsZoomWrapper>
      <SettingsShell
        isAdmin={permissions.isAdmin}
        isResponderOrAbove={permissions.isResponderOrAbove}
      >
        {children}
      </SettingsShell>
    </SettingsZoomWrapper>
  );
}
