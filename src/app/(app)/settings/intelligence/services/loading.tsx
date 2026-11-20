import { SettingsPageSkeleton } from '@/components/patterns';

export default function IntelligenceServicesLoading() {
  return <SettingsPageSkeleton label="Loading per-service policies" variant="table" rows={8} />;
}
