import { DashboardPageSkeleton } from '@/components/patterns';

export default function IntelligenceOverviewLoading() {
  return <DashboardPageSkeleton label="Loading the AIOps overview" stats={12} panels={6} actions />;
}
