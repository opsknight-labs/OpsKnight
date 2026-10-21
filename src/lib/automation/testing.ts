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
  const isProviderPayloadEmpty =
    !input.providerPayload ||
    (typeof input.providerPayload === 'object' &&
      Object.keys(input.providerPayload as object).length === 0);

  const providerFieldsMissing: string[] = [];
  for (const field of compiled.fields) {
    const hasProviderMapping = field.mappings.some(
      m =>
        m.source === 'PROVIDER' &&
        (!m.integrationType || m.integrationType === input.integrationType)
    );
    const hasEventMapping = field.mappings.some(
      m =>
        m.source === 'EVENT' &&
        (!m.integrationType || m.integrationType === input.integrationType)
    );
    if (hasProviderMapping && !hasEventMapping && isProviderPayloadEmpty) {
      providerFieldsMissing.push(field.label);
    }
  }

  const allIssues = [...issues];
  if (providerFieldsMissing.length > 0) {
    allIssues.push({
      level: 'WARNING',
      code: 'PROVIDER_PAYLOAD_UNAVAILABLE',
      message: `Provider-only mapping unavailable for: ${providerFieldsMissing.join(', ')} (no raw provider sample supplied).`,
    });
  }

  const normalization = extracted.normalization.map(item => {
    if (providerFieldsMissing.some(label => {
      const f = compiled.fields.find(cf => cf.key === item.fieldKey);
      return f?.label === label;
    })) {
      return {
        ...item,
        raw: item.raw === null ? '(provider sample unavailable)' : item.raw,
      };
    }
    return item;
  });

  return {
    issues: allIssues,
    classification,
    normalization,
    result,
    goldenResults: goldenResults(),
    durationMs: performance.now() - start,
    providerFieldsMissing,
  };
}
