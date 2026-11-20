import SettingsPageSkeleton from '@/components/settings/layout/SettingsPageSkeleton';

export default function SystemLoading() {
  return <SettingsPageSkeleton label="Loading system settings" sections={3} statsCount={5} tabs />;
}
