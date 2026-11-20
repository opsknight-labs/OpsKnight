import PageHeader, {
  type BreadcrumbItem,
  type PageHeaderProps,
} from '@/components/patterns/PageHeader';
import SettingsSubpageNav from '@/components/settings/SettingsSubpageNav';

export type SettingsPageHeaderProps = Omit<PageHeaderProps, 'breadcrumbs'> & {
  /** Crumbs after the settings page, e.g. `[{ label: statusPage.name }]` on a detail route. */
  trail?: BreadcrumbItem[];
  /** Hide the settings search in the breadcrumb row (focused flows such as consent). */
  hideSearch?: boolean;
};

/**
 * The one header for every settings page: `PageHeader` on the always-dark surface, with the
 * settings breadcrumb trail and the settings-only search above it.
 */
export function SettingsPageHeader({ trail, hideSearch, ...props }: SettingsPageHeaderProps) {
  return (
    <PageHeader
      eyebrow="Workspace Settings"
      {...props}
      breadcrumbs={
        <SettingsSubpageNav currentLabel={props.title} trail={trail} showSearch={!hideSearch} />
      }
    />
  );
}

export default SettingsPageHeader;
