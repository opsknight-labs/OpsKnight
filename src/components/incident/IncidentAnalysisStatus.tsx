import { incidentAnalysisStateForRequest } from '@/lib/intelligence/analysis/view';
import IncidentAnalysisNotice from './IncidentAnalysisNotice';
export default async function IncidentAnalysisStatus({ incidentId }: { incidentId: string }) {
  const state = await incidentAnalysisStateForRequest(incidentId);
  return state ? (
    <IncidentAnalysisNotice
      key={`${incidentId}:${state.status}:${state.lastSuccessfulAt ?? ''}`}
      incidentId={incidentId}
      initial={state}
    />
  ) : null;
}
