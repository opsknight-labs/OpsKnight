'use client';

import { SettingsPageHeader as StandardHeader } from './layout/SettingsPageHeader';
import { SETTINGS_NAV_SECTIONS } from './navConfig';

type Props = {
  currentPageId?: string;
  title?: string;
  description?: string;
  isAdmin?: boolean;
  isResponderOrAbove?: boolean;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
};

export default function SettingsPageHeader({
  currentPageId,
  title,
  description,
  actions,
  badge,
}: Props) {
  const currentPage = currentPageId
    ? SETTINGS_NAV_SECTIONS.flatMap(section => section.items).find(
        item => item.id === currentPageId
      )
    : null;

  return (
    <StandardHeader
      title={title || currentPage?.label || 'Settings'}
      description={description || currentPage?.description}
      backHref="/settings"
      backLabel="Settings"
      actions={actions}
      badge={badge}
    />
  );
}

export { SettingsPageHeader };
