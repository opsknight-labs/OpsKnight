import { testAutomation, goldenResults } from './testing';
import { isSensitiveValue } from './context/privacy';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { runSerializableTransaction } from '@/lib/db-utils';
import { compileAutomation } from './compiler';
import { readAutomationVersion } from './history';
import { saveDraft, validateReferences } from './versioning';

export function assertAutomationPayloadSize(input: unknown) {
  let serialized: string;
  try {
    serialized = JSON.stringify(input) ?? '';
  } catch {
    throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Invalid automation payload.' });
  }
  if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024)
    throw new AppError({ code: 'PAYLOAD_TOO_LARGE' });
}

/** Publication validation only. Activation must additionally pass its current
 * global-switch, dependency and version-specific readiness checks.
 */
export async function validateAutomationSnapshot(
  tx: Prisma.TransactionClient,
  serviceId: string,
  snapshot: unknown
) {
  assertAutomationPayloadSize(snapshot);
  const { compiled, issues } = compileAutomation(snapshot);
  if (!issues.some(issue => issue.level === 'ERROR')) {
    try {
      await validateReferences(tx, serviceId, compiled);
    } catch (error) {
      if (!(error instanceof AppError) || error.status >= 500 || error.exposure !== 'public')
        throw error;
      issues.push({ level: 'ERROR', code: 'INVALID_REFERENCE', message: error.userMessage });
    }
  }
  return { compiled, issues };
}

/** Copy immutable history into a fenced editable draft; never changes mode or
 * active/candidate pointers. Publication remains an explicit, separate command.
 */
export async function restoreAutomationDraft(
  input: {
    serviceId: string;
    actorId: string;
    sourceVersionId: string;
    expectedRevision: number;
  },
  externalTx?: Prisma.TransactionClient,
  apiClientId?: string
) {
  const run = async (tx: Prisma.TransactionClient) => {
    const version = await readAutomationVersion(tx, input.serviceId, input.sourceVersionId);
    return saveDraft(
      {
        serviceId: input.serviceId,
        actorId: input.actorId,
        expectedRevision: input.expectedRevision,
        snapshot: version.snapshot,
        restoredFromVersionId: version.id,
      },
      tx,
      apiClientId
    );
  };
  return externalTx ? run(externalTx) : runSerializableTransaction(run);
}

/** The UI and REST share the production evaluator and reference checks. */
export async function simulateAutomationSnapshot(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof testAutomation>[1]
) {
  assertAutomationPayloadSize(input);
  if (
    input.integrationId &&
    !(await tx.integration.findFirst({
      where: { id: input.integrationId, serviceId: input.serviceId },
      select: { id: true },
    }))
  )
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Integration does not belong to this service.',
    });
  const validation = await validateAutomationSnapshot(tx, input.serviceId, input.snapshot);
  if (validation.issues.some(issue => issue.level === 'ERROR'))
    return {
      issues: validation.issues,
      result: null,
      classification: null,
      durationMs: 0,
      goldenResults: goldenResults(),
    };
  const result = await testAutomation(tx, {
    ...input,
    providerPayload: input.providerPayload === undefined ? input.event : input.providerPayload,
  });
  return { ...result, issues: validation.issues };
}

/** Diagnostics expose outcomes and condition truth states, never source payloads,
 * received values, enrichment values or notification credentials.
 */
export function publicAutomationSimulation(
  value: Awaited<ReturnType<typeof simulateAutomationSnapshot>>
) {
  const safeText = (text: string) => (isSensitiveValue(text) ? '[redacted]' : text);
  const result = value.result;
  return {
    valid: !value.issues.some(issue => issue.level === 'ERROR'),
    durationMs: value.durationMs,
    issues: value.issues.map(issue => ({
      ...issue,
      message: safeText(issue.message),
      ...(issue.ruleId ? { ruleId: safeText(issue.ruleId) } : {}),
    })),
    result: result
      ? {
          evaluationAt: result.evaluationAt,
          outcome: result.outcome,
          matchedRuleId: result.matchedRule ? safeText(result.matchedRule.id) : null,
          priority:
            result.enrichedContext.priority?.state === 'RECOGNIZED'
              ? String(result.enrichedContext.priority.value)
              : null,
          tags: result.tags.filter(tag => !isSensitiveValue(tag)),
          contextStates: Object.fromEntries(
            Object.entries(result.enrichedContext).map(([key, field]) => [key, field.state])
          ),
          rules: [
            ...result.enrichmentRuleResults.map(rule => ({
              phase: 'ENRICH' as const,
              ruleId: safeText(rule.ruleId),
              result: rule.result,
              conditions: rule.terms.map(term => ({
                fieldKey: safeText(term.condition.fieldKey),
                operator: term.condition.operator,
                result: term.result,
              })),
            })),
            ...result.routingRuleResults.map(rule => ({
              phase: 'ROUTE' as const,
              ruleId: safeText(rule.ruleId),
              result: rule.result,
              conditions: rule.terms.map(term => ({
                fieldKey: safeText(term.condition.fieldKey),
                operator: term.condition.operator,
                result: term.result,
              })),
            })),
          ],
        }
      : null,
  };
}
