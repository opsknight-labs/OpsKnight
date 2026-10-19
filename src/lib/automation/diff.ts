import type { Snapshot } from './contract';
/** Compare authored snapshots by stable identity, including order changes. */
export function compareSnapshots(before: Snapshot, after: Snapshot): string[] {
  const changes: string[] = [];
  for (const [label, previous, next] of [
    ['Field', before.fields, after.fields],
    ['Rule', before.rules, after.rules],
  ] as const) {
    const identity = (item: (typeof previous)[number]) =>
      'fieldId' in item ? item.fieldId : item.id;
    const name = (item: (typeof previous)[number]) => ('label' in item ? item.label : item.name);
    for (const item of previous) {
      const updated = next.find(candidate => identity(candidate) === identity(item));
      if (!updated) changes.push(`${label} removed: ${name(item)}`);
      else if (JSON.stringify(item) !== JSON.stringify(updated))
        changes.push(`${label} changed: ${name(updated)}`);
    }
    for (const item of next)
      if (!previous.some(candidate => identity(candidate) === identity(item)))
        changes.push(`${label} added: ${name(item)}`);
    if (previous.map(identity).join('|') !== next.map(identity).join('|'))
      changes.push(`${label} order changed`);
  }
  return changes;
}

/** Human-readable operational differences; catalog labels stay out of engine snapshots. */
export function semanticSnapshotChanges(
  before: Snapshot,
  after: Snapshot,
  catalogs: {
    policies?: Array<{ id: string; name: string }>;
    destinations?: Array<{ id: string; channelName?: string | null; provider: string }>;
  } = {}
): string[] {
  const describe = (rule: Snapshot['rules'][number]) =>
    rule.actions
      .map(action => {
        switch (action.type) {
          case 'USE_SERVICE_DEFAULT':
            return 'Service default';
          case 'NO_ESCALATION':
            return 'No responder paging';
          case 'USE_ESCALATION_POLICY':
            return (
              catalogs.policies?.find(p => p.id === action.policyId)?.name ??
              'Selected escalation policy'
            );
          case 'SET_PRIORITY':
            return `Priority ${action.value}`;
          case 'SET_CONTEXT':
            return `${action.fieldKey} = ${action.value}`;
          case 'ADD_TAG':
            return `Tag ${action.value}`;
          case 'NOTIFY_CHANNEL':
            return `${action.provider} · ${catalogs.destinations?.find(d => d.id === action.destinationId)?.channelName ?? 'Configured destination'}`;
        }
      })
      .join('; ');
  const changes: string[] = [];
  const oldRules = new Map(before.rules.map(rule => [rule.id, rule]));
  const newRules = new Map(after.rules.map(rule => [rule.id, rule]));
  for (const rule of after.rules) {
    const prior = oldRules.get(rule.id);
    if (!prior) changes.push(`Added ${rule.name}: ${describe(rule)}`);
    else if (JSON.stringify(prior) !== JSON.stringify(rule)) {
      const details: string[] = [];
      if (JSON.stringify(prior.actions) !== JSON.stringify(rule.actions))
        details.push(`Before: ${describe(prior)} → After: ${describe(rule)}`);
      if (JSON.stringify(prior.conditions) !== JSON.stringify(rule.conditions))
        details.push(
          `Conditions: ${prior.conditions.map(c => `${c.fieldKey} ${c.operator} ${JSON.stringify(c.value ?? '')}`).join(' AND ') || 'Every alert'} → ${rule.conditions.map(c => `${c.fieldKey} ${c.operator} ${JSON.stringify(c.value ?? '')}`).join(' AND ') || 'Every alert'}`
        );
      if (prior.enabled !== rule.enabled) details.push(rule.enabled ? 'Enabled' : 'Disabled');
      if (prior.name !== rule.name) details.push(`Renamed from ${prior.name}`);
      changes.push(`${rule.name}: ${details.join(' · ') || 'Rule settings changed'}`);
    }
  }
  for (const rule of before.rules)
    if (!newRules.has(rule.id)) changes.push(`Removed ${rule.name}: ${describe(rule)}`);
  for (const phase of ['ENRICH', 'ROUTE']) {
    const previous = before.rules
      .filter(r => r.phase === phase && newRules.has(r.id))
      .map(r => r.id);
    const next = after.rules.filter(r => r.phase === phase && oldRules.has(r.id)).map(r => r.id);
    if (previous.join('|') !== next.join('|'))
      changes.push(
        `${phase === 'ROUTE' ? 'Routing' : 'Enrichment'} precedence changed: ${next.map(id => newRules.get(id)?.name).join(' → ')}`
      );
  }
  changes.push(...compareSnapshots({ ...before, rules: [] }, { ...after, rules: [] }));
  return changes;
}
