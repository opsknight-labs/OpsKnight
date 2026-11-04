import { incidentAnalysisStateForRequest } from '@/lib/intelligence/analysis/view';
export default async function IntelligenceEmptyState({ incidentId }: { incidentId: string }) {
  const state = await incidentAnalysisStateForRequest(incidentId);
  const message =
    state?.status === 'CURRENT' && state.lastSuccessfulAt
      ? 'Analysis completed with no qualifying suggestions of this kind that you can read.'
      : state?.message;
  return message ? (
    <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      {message}
    </p>
  ) : null;
}
