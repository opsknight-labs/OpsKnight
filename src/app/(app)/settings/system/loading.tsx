import { SettingsPageSkeleton } from '@/components/patterns';

export default function SystemLoading() {
  return <SettingsPageSkeleton label="Loading system settings" sections={3} statsCount={5} tabs />;
}
