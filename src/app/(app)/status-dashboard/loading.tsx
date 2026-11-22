import { DashboardPageSkeleton } from '@/components/patterns';

export default function StatusDashboardLoading() {
  return (
    <DashboardPageSkeleton label="Loading the status dashboard" stats={3} panels={6} actions />
  );
}
