import { SettingsPageSkeleton } from '@/components/patterns';

export default function ProfileLoading() {
  return <SettingsPageSkeleton label="Loading profile" sections={3} statsCount={3} tabs />;
}
