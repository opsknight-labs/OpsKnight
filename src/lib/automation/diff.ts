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
