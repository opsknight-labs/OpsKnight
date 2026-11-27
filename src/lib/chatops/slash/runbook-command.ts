/** `/incident runbook`: ephemeral list of the incident's runbooks with Preview buttons (see slack/runbook-flow). */
import { listIncidentRunbooks } from '@/lib/slack/runbook-flow';

export const handleRunbookCommand = (incident: { id: string }, actor: { id: string }) =>
  listIncidentRunbooks(incident.id, actor.id);
