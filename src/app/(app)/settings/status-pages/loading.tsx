import { SettingsPageSkeleton } from '@/components/patterns';

export default function StatusPagesLoading() {
  return (
    <SettingsPageSkeleton label="Loading status pages" variant="cards" rows={2} statsCount={4} />
  );
}
