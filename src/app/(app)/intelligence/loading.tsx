import { DashboardPageSkeleton } from '@/components/patterns';

export default function IntelligenceOverviewLoading() {
  return (
    <DashboardPageSkeleton label="Loading the Intelligence overview" stats={4} panels={6} actions />
  );
}
