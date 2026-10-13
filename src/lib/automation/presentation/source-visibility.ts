type IncidentSource = {
  title?: string;
  description?: string | null;
  events?: Array<{ message: string }>;
  automationTraces?: Array<{ incidentId: string }>;
  automationDecision?: { incidentId: string } | null;
};

/** Source details can duplicate protected context; strip them before client serialization. */
export function visibleIncidentSource<T extends IncidentSource>(incident: T, sensitive: boolean) {
  const { automationDecision, automationTraces, ...visible } = incident;
  return (automationDecision || automationTraces?.length) && !sensitive
    ? {
        ...visible,
        ...(typeof visible.title === 'string' ? { title: 'Restricted alert content' } : {}),
        ...(visible.events
          ? {
              events: visible.events.map(event => ({
                ...event,
                message: event.message.startsWith('Re-triggered by event')
                  ? 'Alert re-triggered. Source content is restricted.'
                  : event.message,
              })),
            }
          : {}),
        description: null,
        descriptionRestricted: true,
      }
    : visible;
}
