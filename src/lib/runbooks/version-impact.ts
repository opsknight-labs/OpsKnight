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
    select: {
      id: true,
      name: true,
      serviceId: true,
      enabled: true,
      mode: true,
      versionStrategy: true,
      runbookVersionId: true,
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
    rules: rules.slice(0, 500).map(rule => ({
      ...rule,
      impact:
        rule.versionStrategy === 'LATEST_PUBLISHED' ? 'TRACKS_NEW_PUBLICATION' : 'PINNED_UNCHANGED',
    })),
    rulesTruncated: rules.length > 500,
    warning:
      'Comparison is static. Existing executions and pinned rules retain their frozen versions. Local policy and permission checks are required before activation.',
  };
}
