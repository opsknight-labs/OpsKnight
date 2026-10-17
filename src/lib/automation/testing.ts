import type { Prisma } from '@prisma/client';
import { builtinContext } from './context/builtins';
import { compileAutomation } from './compiler';
import { evaluateAutomation } from './evaluator';
import { extractContextWithProvenance } from './context/extract';
import type { EventPayload } from '@/lib/events';
import { resolveIncidentClassification } from '@/lib/incidents/classification';
import { goldenResults } from './golden';
export { goldenResults } from './golden';
export async function testAutomation(
  tx: Prisma.TransactionClient,
  input: {
    snapshot: unknown;
    serviceId: string;
    integrationId?: string;
    integrationType: string;
    event: EventPayload;
    providerPayload: unknown;
    evaluationAt: string;
  }
) {
  const { compiled, issues } = compileAutomation(input.snapshot);
  if (issues.some(i => i.level === 'ERROR'))
    return {
      issues,
      goldenResults: goldenResults(),
      result: null,
      classification: null,
      durationMs: 0,
    };
  const classification = await resolveIncidentClassification(tx, {
    serviceId: input.serviceId,
    integrationId: input.integrationId,
    alertSeverity: input.event.payload.severity,
  });
  const start = performance.now();
  const extracted = extractContextWithProvenance({
    fields: compiled.fields,
    providerPayload: input.providerPayload,
    normalizedEvent: input.event,
    integrationType: input.integrationType,
  });
  const context = extracted.context;
  Object.assign(
    context,
    builtinContext({
      ...classification,
      severity: input.event.payload.severity,
      integrationType: input.integrationType,
      source: input.event.payload.source,
    })
  );
  const result = evaluateAutomation({
    version: compiled,
    initialContext: context,
    evaluationAt: input.evaluationAt,
  });
  return {
    issues,
    classification,
    normalization: extracted.normalization,
    result,
    goldenResults: goldenResults(),
    durationMs: performance.now() - start,
  };
}
