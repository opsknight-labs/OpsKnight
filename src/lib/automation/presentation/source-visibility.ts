type IncidentSource = {
  automationSourceRestricted?: boolean;
  title?: string;
  description?: string | null;
  events?: Array<{ message: string }>;
  automationTraces?: Array<{ incidentId: string }>;
  automationDecision?: { incidentId: string } | null;
};

/** Source details can duplicate protected context; strip them before client serialization. */
export function visibleIncidentSource<T extends IncidentSource>(incident: T, sensitive: boolean) {
  const { automationDecision, automationTraces, ...visible } = incident;
  return (incident.automationSourceRestricted || automationDecision || automationTraces?.length) &&
    !sensitive
    ? {
        ...visible,
        ...(typeof visible.title === 'string' ? { title: 'Restricted alert content' } : {}),
        ...(visible.events
          ? {
              events: visible.events.map(event => ({
                ...event,
                message: visibleSourceEventMessage(event.message),
              })),
            }
          : {}),
        description: null,
        descriptionRestricted: true,
      }
    : visible;
}

function visibleSourceEventMessage(message: string): string {
  if (message.startsWith('Re-triggered by event'))
    return 'Alert re-triggered. Source content is restricted.';
  if (message.startsWith('Incident triggered via API'))
    return 'Incident triggered by an integration. Source content is restricted.';
  if (message.startsWith('Incident created in resolved state: resolve event'))
    return 'Incident created resolved after an earlier recovery event. Source content is restricted.';
  if (message.startsWith('Incident created in SUPPRESSED state: rapid alert oscillations'))
    return 'Incident suppressed after rapid alert oscillation. Source content is restricted.';
  return message;
}
