'use client';

import { usePathname } from 'next/navigation';
import { Breadcrumbs, type BreadcrumbItem } from '@/components/patterns/PageHeader';
import { buildSettingsBreadcrumbs } from '@/components/settings/settings-breadcrumbs';
import SettingsSearchTrigger from '@/components/settings/SettingsSearchTrigger';
import { cn } from '@/lib/utils';

/**
 * The breadcrumb row above every settings page header, with the settings-only search on the
 * right. Rendered by `SettingsPageHeader`; returns nothing on the settings home.
 */
export default function SettingsSubpageNav({
  currentLabel,
  trail,
  showSearch = true,
}: {
  /** Label for the last crumb on a detail route (usually the page title). */
  currentLabel?: string;
  /** Crumbs after the settings page (e.g. a status page name). */
  trail?: BreadcrumbItem[];
  showSearch?: boolean;
}) {
  const pathname = usePathname();
  if (!pathname || pathname === '/settings') return null;

  const crumbs = buildSettingsBreadcrumbs(pathname, { currentLabel, trail });

  return (
    <div className="flex items-center justify-between gap-3">
      <Breadcrumbs
        items={crumbs}
        className={cn(
          // Touch-target min-heights on phones make links taller than the text; keep it centred.
          'flex-1 [&_a]:inline-flex [&_a]:items-center',
          // On phones the section crumb is dropped so the trail stays on one line.
          crumbs.length > 2 && '[&_li:nth-child(2)]:hidden md:[&_li:nth-child(2)]:flex'
        )}
      />
      {showSearch && <SettingsSearchTrigger className="shrink-0" />}
    </div>
  );
}
