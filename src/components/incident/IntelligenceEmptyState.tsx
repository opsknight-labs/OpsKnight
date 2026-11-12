import EmptyState from '@/components/ui/EmptyState';
import { incidentAnalysisStateForRequest } from '@/lib/intelligence/analysis/view';

export default async function IntelligenceEmptyState({
  incidentId,
  kind = 'recommendations',
}: {
  incidentId: string;
  kind?: 'recommendations' | 'related';
}) {
  const state = await incidentAnalysisStateForRequest(incidentId);
  if (!state) return null;
  const message =
    kind === 'related'
      ? 'No related incidents are available to show.'
      : state.status === 'CURRENT' && state.lastSuccessfulAt
        ? 'No qualifying suggestions of this kind that you can read.'
        : state.status === 'CURRENT'
          ? state.message
          : 'No verified suggestions are available in this section yet.';
  return (
    <EmptyState
      size="sm"
      variant="dashed"
      title={message}
      className="items-start p-4 text-left sm:p-4"
    />
  );
}
