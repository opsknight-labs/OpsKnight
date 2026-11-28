/**
 * What the incident page says in the place the AI briefing would be, when there is no briefing: Intelligence is
 * off, only watching, or on but nothing has been written. Pure, so each case is testable without a page.
 */
export type IncidentIntelligenceMode = 'OFF' | 'SHADOW' | 'SUGGEST' | 'AUTO';

export type IncidentStateNote =
  | { kind: 'off'; text: string; action: { label: string; href: string } | null }
  | { kind: 'watching'; text: string; action: { label: string; href: string } | null }
  /** On, but no written briefing: offer the summary the person can ask for. */
  | { kind: 'summary' };

export function incidentStateNote(
  mode: IncidentIntelligenceMode,
  canManage: boolean
): IncidentStateNote {
  if (mode === 'OFF')
    return {
      kind: 'off',
      text: canManage
        ? 'Intelligence is off for this service, so there are no suggestions here.'
        : 'Intelligence is off for this service, so there are no suggestions here. Ask an administrator to turn it on.',
      action: canManage ? { label: 'Turn on', href: '/settings/intelligence/setup' } : null,
    };
  if (mode === 'SHADOW')
    return {
      kind: 'watching',
      text: 'Intelligence is watching this incident. Suggestions are not shown to your team yet.',
      action: canManage ? { label: 'Show suggestions', href: '/settings/intelligence' } : null,
    };
  return { kind: 'summary' };
}
