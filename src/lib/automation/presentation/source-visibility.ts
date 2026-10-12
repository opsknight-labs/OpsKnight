type IncidentSource = {
  description?: string | null;
  automationDecision?: { incidentId: string } | null;
};

/** Source details can duplicate protected context; strip them before client serialization. */
export function visibleIncidentSource<T extends IncidentSource>(incident: T, sensitive: boolean) {
  const { automationDecision, ...visible } = incident;
  return automationDecision && !sensitive
    ? { ...visible, description: null, descriptionRestricted: true }
    : visible;
}
