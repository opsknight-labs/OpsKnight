import { DashboardPageSkeleton } from '@/components/patterns';

export default function AnalyticsLoading() {
  return <DashboardPageSkeleton label="Loading analytics" stats={8} panels={6} />;
}
