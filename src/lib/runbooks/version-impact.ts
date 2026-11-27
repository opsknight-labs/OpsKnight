import { RunbookVersionNotFoundError } from './errors';
import 'server-only';
import prisma from '@/lib/prisma';
import { flattenSteps, parseRunbookDefinition, sortJsonValue } from './definition';
import { minimumRiskForStep } from './shared-definition';
export async function getVersionImpact(
  runbookId: string,
  baseVersionId: string,
  nextVersionId: string
) {
  const versions = await prisma.runbookVersion.findMany({
    where: { runbookId, id: { in: [baseVersionId, nextVersionId] } },
    include: { inputs: true },
  });
  const base = versions.find(version => version.id === baseVersionId);
  const next = versions.find(version => version.id === nextVersionId);
  if (!base) throw new RunbookVersionNotFoundError(baseVersionId);
  if (!next) throw new RunbookVersionNotFoundError(nextVersionId);
  const baseDefinition = parseRunbookDefinition(base.definition, base.inputs);
  const nextDefinition = parseRunbookDefinition(next.definition, next.inputs);
  const before = new Map(flattenSteps(baseDefinition).map(step => [step.key, step]));
  const after = new Map(flattenSteps(nextDefinition).map(step => [step.key, step]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  // Position among the steps both versions have, so an added or removed step does not count as a move.
  const shared = (own: Map<string, unknown>, other: Map<string, unknown>) =>
    [...own.keys()].filter(key => other.has(key));
  const beforeOrder = shared(before, after);
  const afterOrder = shared(after, before);
  const steps = [...keys].map(key => {
    const moved =
      before.has(key) && after.has(key) && beforeOrder.indexOf(key) !== afterOrder.indexOf(key);
    return {
      key,
      before: before.get(key) ?? null,
      after: after.get(key) ?? null,
      moved,
      change: !before.has(key)
        ? 'ADDED'
        : !after.has(key)
          ? 'REMOVED'
          : moved ||
              JSON.stringify(sortJsonValue(before.get(key))) !==
                JSON.stringify(sortJsonValue(after.get(key)))
            ? 'CHANGED'
            : 'UNCHANGED',
      risk: after.get(key) ? minimumRiskForStep(after.get(key)!) : null,
    };
  });
  const runDefaults = (definition: typeof baseDefinition) => ({
    timeoutSeconds: definition.defaultTimeoutSeconds ?? null,
    maxRetries: definition.defaultMaxRetries ?? null,
  });
  const defaults = { before: runDefaults(baseDefinition), after: runDefaults(nextDefinition) };
  const inputChanges = next.inputs.flatMap(input => {
    const previous = base.inputs.find(candidate => candidate.key === input.key);
    if (!previous) return [];
    // Default values are named, never returned: they can be sensitive.
    const changes = [
      previous.type !== input.type && 'type',
      previous.required !== input.required && 'required',
      previous.defaultValue !== input.defaultValue && 'default',
      JSON.stringify(previous.options) !== JSON.stringify(input.options) && 'options',
    ].filter((change): change is 'type' | 'required' | 'default' | 'options' => change !== false);
    return changes.length
      ? [
          {
            key: input.key,
            changes,
            type: { before: previous.type, after: input.type },
            required: { before: previous.required, after: input.required },
          },
        ]
      : [];
  });
  const runbook = await prisma.runbook.findUnique({
    where: { id: runbookId },
    select: { publishedVersionId: true },
  });
  // Detached rules never run, so they are not affected by any version.
  const rules = await prisma.serviceAutomationRule.findMany({
    where: { runbookId, detachedAt: null },
    include: {
      service: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    // Rules that follow the latest publication first, so a truncated list keeps the ones this affects.
    orderBy: [{ versionStrategy: 'desc' }, { enabled: 'desc' }, { id: 'asc' }],
    take: 501,
  });
  return {
    base: { version: base.version, checksum: base.checksum },
    next: { version: next.version, checksum: next.checksum },
    steps,
    defaults: {
      ...defaults,
      changed: JSON.stringify(defaults.before) !== JSON.stringify(defaults.after),
    },
    inputChanges,
    inputKeys: {
      added: next.inputs
        .filter(input => !base.inputs.some(previous => previous.key === input.key))
        .map(input => input.key),
      removed: base.inputs
        .filter(input => !next.inputs.some(current => current.key === input.key))
        .map(input => input.key),
    },
    inputDetails: {
      added: next.inputs
        .filter(input => !base.inputs.some(previous => previous.key === input.key))
        .map(input => ({
          key: input.key,
          label: input.label,
          type: input.type,
          required: input.required,
        })),
      removed: base.inputs
        .filter(input => !next.inputs.some(current => current.key === input.key))
        .map(input => ({
          key: input.key,
          label: input.label,
          type: input.type,
          required: input.required,
        })),
      baseCount: base.inputs.length,
      nextCount: next.inputs.length,
    },
    rules: rules.slice(0, 500).map(rule => {
      const service =
        'service' in rule &&
        rule.service &&
        typeof rule.service === 'object' &&
        'name' in rule.service
          ? {
              id: String((rule.service as { id?: unknown }).id ?? ''),
              name: String((rule.service as { name?: unknown }).name ?? ''),
            }
          : null;
      return {
        id: rule.id,
        name: rule.name,
        serviceId: rule.serviceId,
        enabled: rule.enabled,
        mode: rule.mode,
        versionStrategy: rule.versionStrategy,
        runbookVersionId: rule.runbookVersionId,
        service,
        // A latest-publication rule runs the live version: only the draft or live version compared is its new target.
        impact:
          rule.versionStrategy !== 'LATEST_PUBLISHED'
            ? 'PINNED_UNCHANGED'
            : next.state === 'DRAFT' || runbook?.publishedVersionId === next.id
              ? 'TRACKS_NEW_PUBLICATION'
              : 'TRACKS_LIVE_VERSION',
      };
    }),
    rulesTruncated: rules.length > 500,
    warning:
      'Comparison is static. Existing executions and pinned rules retain their frozen versions. Local policy and permission checks are required before activation.',
  };
}
