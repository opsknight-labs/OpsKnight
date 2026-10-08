'use client';
const formatState = (state: unknown) => {
  if (!state || typeof state !== 'object') return 'Missing';
  const value = state as { state?: string; value?: unknown; raw?: unknown };
  return value.state === 'RECOGNIZED'
    ? String(value.value)
    : value.state === 'UNMAPPED'
      ? `${String(value.raw)} (unmapped)`
      : 'Missing';
};

export function TraceDetail({ detail }: { detail: unknown }) {
  const trace = detail as {
    diagnosticLevel?: string;
    policyName?: string | null;
    destinationNames?: Array<{ provider: string; destinationId: string; label: string }>;
    result?: {
      matchedRule?: { name: string };
      tags?: string[];
      inputContext?: Record<string, unknown>;
      enrichedContext?: Record<string, unknown>;
      writes?: Array<{ ruleId: string; fieldKey: string; value: unknown }>;
      enrichmentRuleResults?: Array<{ ruleName: string; result: string }>;
      routingRuleResults?: Array<{ ruleName: string; result: string }>;
      outcome?: { type: string; policyId?: string };
      supplementalActions?: Array<{ provider: string; destinationId: string }>;
    };
    actual?: { priority?: string; route?: string };
    fallbackReason?: string;
    normalization?: Array<{ fieldKey: string; raw: unknown; canonical: unknown }>;
  };
  const result = trace.result;
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="font-medium">Current behavior</h4>
          <p>
            Priority {trace.actual?.priority ?? 'Unset'} ·{' '}
            {trace.actual?.route === 'SERVICE_DEFAULT'
              ? 'Service default'
              : (trace.actual?.route ?? 'Service default')}
          </p>
        </div>
        <div>
          <h4 className="font-medium">Automation outcome</h4>
          <p>
            {trace.fallbackReason ??
              (result?.outcome?.type === 'NO_ESCALATION'
                ? 'No responder paging'
                : result?.outcome?.type === 'ESCALATION_POLICY'
                  ? (trace.policyName ?? 'Selected escalation policy')
                  : 'Service default') ??
              'Service default'}
          </p>
          <p>Final priority: {formatState(result?.enrichedContext?.priority)}</p>
        </div>
      </div>
      {result?.matchedRule && (
        <p>
          Selected by: <strong>{result.matchedRule.name}</strong>
        </p>
      )}
      {!!result?.tags?.length && <p>Tags: {result.tags.join(', ')}</p>}
      {trace.diagnosticLevel === 'COMPACT' && (
        <p className="text-muted-foreground">
          Compact success record. Detailed diagnostics are retained for differences, fallbacks, and
          sampled evaluations; Test can explain the full policy.
        </p>
      )}
      <h4 className="font-medium">Why · normalization and matched rules</h4>
      {trace.normalization?.map(n => (
        <p key={n.fieldKey}>
          {n.fieldKey}: {String(n.raw ?? 'Missing')} → {formatState(n.canonical)}
        </p>
      ))}
      {Object.entries(result?.inputContext ?? {}).map(([key, value]) => (
        <p key={key}>
          {key}: {formatState(value)}
        </p>
      ))}
      <h4 className="font-medium">Enrichment</h4>
      {result?.enrichmentRuleResults?.map((r, i) => (
        <p key={i}>
          {r.ruleName}: {r.result}
        </p>
      ))}
      {result?.writes?.map((w, i) => (
        <p key={i}>
          {w.fieldKey} → {String(w.value)}
        </p>
      ))}
      <h4 className="font-medium">Routing</h4>
      {result?.routingRuleResults?.map((r, i) => (
        <p key={i}>
          {r.ruleName}: {r.result}
        </p>
      ))}
      {result?.supplementalActions?.map((a, i) => (
        <p key={i}>
          Also notify {a.provider} ·{' '}
          {trace.destinationNames?.find(
            d => d.destinationId === a.destinationId && d.provider === a.provider
          )?.label ?? 'Configured destination'}
        </p>
      ))}
      <details>
        <summary className="cursor-pointer text-muted-foreground">Advanced diagnostics</summary>
        <pre className="max-w-full overflow-auto text-xs">{JSON.stringify(detail, null, 2)}</pre>
      </details>
    </div>
  );
}
