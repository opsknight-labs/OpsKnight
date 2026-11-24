/**
 * "Why is this P1?" in one line, from fields already on the incident row (no extra reads): how the priority
 * was set at creation and which SLA rule its targets come from.
 */
export function priorityReason(input: {
  priority: string | null;
  source: string | null;
  rule: string | null;
  slaRule: string | null;
}): string | null {
  if (!input.priority) return null;
  const how =
    input.source === 'CLASSIFICATION_RULE'
      ? input.rule
        ? `Set by rule “${input.rule}”`
        : 'Set by a classification rule'
      : input.source === 'NONE' || !input.source
        ? null
        : input.source === 'EXPLICIT' || input.source === 'MANUAL' || input.source === 'USER'
          ? 'Set when the incident was created'
          : input.source === 'ALERT' || input.source === 'PAYLOAD'
            ? "From the alert's severity"
            : `Set by ${input.source.toLowerCase().replace(/_/g, ' ')}`;
  const sla = input.slaRule ? `SLA rule “${input.slaRule}”` : null;
  return [how, sla].filter(Boolean).join(' · ') || null;
}
