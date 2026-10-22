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
  const before = new Map(
    flattenSteps(parseRunbookDefinition(base.definition, base.inputs)).map(step => [step.key, step])
  );
  const after = new Map(
    flattenSteps(parseRunbookDefinition(next.definition, next.inputs)).map(step => [step.key, step])
  );
  const keys = new Set([...before.keys(), ...after.keys()]);
  const steps = [...keys].map(key => ({
    key,
    before: before.get(key) ?? null,
    after: after.get(key) ?? null,
    change: !before.has(key)
      ? 'ADDED'
      : !after.has(key)
        ? 'REMOVED'
        : JSON.stringify(sortJsonValue(before.get(key))) !==
            JSON.stringify(sortJsonValue(after.get(key)))
          ? 'CHANGED'
          : 'UNCHANGED',
    risk: after.get(key) ? minimumRiskForStep(after.get(key)!) : null,
  }));
  const rules = await prisma.serviceAutomationRule.findMany({
    where: { runbookId },
    include: {
      service: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { id: 'asc' },
    take: 501,
  });
  return {
    base: { version: base.version, checksum: base.checksum },
    next: { version: next.version, checksum: next.checksum },
    steps,
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
        impact:
          rule.versionStrategy === 'LATEST_PUBLISHED'
            ? 'TRACKS_NEW_PUBLICATION'
            : 'PINNED_UNCHANGED',
      };
    }),
    rulesTruncated: rules.length > 500,
    warning:
      'Comparison is static. Existing executions and pinned rules retain their frozen versions. Local policy and permission checks are required before activation.',
  };
}
