import { snapshotSchema } from '@/lib/automation/contract';
import { decodeExplanation } from '@/lib/automation/explanation';
import prisma from '@/lib/prisma';
import { assertCanViewIncident, getUserPermissions } from '@/lib/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
export default async function IncidentAutomationCard({ incidentId }: { incidentId: string }) {
  await assertCanViewIncident(incidentId);
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes('automation.read')) return null;
  const sensitive = permissions.capabilities.includes('incident.sensitive.read');
  const decision = await prisma.incidentAutomationDecision.findUnique({
    where: { incidentId },
    include: { version: { select: { versionNumber: true, snapshot: true } } },
  });
  if (!decision) return null;
  const summary = (sensitive ? decodeExplanation(decision.summary) : {}) as {
    inputContext?: Record<string, { state: string; value?: unknown; raw?: unknown }>;
    enrichedContext?: Record<string, { state: string; value?: unknown; raw?: unknown }>;
    normalization?: Array<{
      fieldKey: string;
      raw: unknown;
      canonical: { state: string; value?: unknown };
    }>;
    writes?: Array<{ fieldKey: string; value: unknown }>;
    diagnosticsOmitted?: boolean;
    omittedValues?: number[];
  };
  const version = snapshotSchema.safeParse(decision.version?.snapshot);
  const fields = version.success ? version.data.fields : [];
  const context = summary.enrichedContext ?? summary.inputContext ?? {};
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert Context</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="mb-3 text-muted-foreground">
            Mapped context captured when this incident was created.
          </p>
          {sensitive && (summary.diagnosticsOmitted || !!summary.omittedValues?.length) && (
            <p className="mb-3">Some diagnostic values were omitted from the stored explanation.</p>
          )}
          {!sensitive ? (
            <p>Alert context is restricted.</p>
          ) : fields.length ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              {fields.map(field => {
                const value = context[field.key];
                return (
                  <div key={field.key} className="min-w-0">
                    <dt className="font-medium">{field.label}</dt>
                    <dd className="break-words text-muted-foreground">
                      {!value || value.state === 'MISSING'
                        ? 'Not provided'
                        : value.state === 'UNMAPPED'
                          ? 'Unrecognized value'
                          : String(value.value ?? 'Not provided')}
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <p>No mapped alert context was captured.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {decision.routeType === 'NO_ESCALATION'
              ? 'How was this incident routed?'
              : 'Why was I paged?'}{' '}
            <Badge variant="outline">Automation · v{decision.version?.versionNumber ?? '—'}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{decision.matchedRouteRuleName ?? 'Service default routing'}</p>
          <p>
            Priority: {decision.basePriority ?? 'Unset'} → {decision.finalPriority ?? 'Unset'}
          </p>
          <p>
            Responder route:{' '}
            {decision.routeType === 'NO_ESCALATION'
              ? 'No responder paging'
              : (decision.escalationPolicyNameSnapshot ?? 'Service default')}
          </p>
          {decision.fallbackReason && <p>Fallback: {decision.fallbackReason}</p>}
          {!sensitive && <p>Evaluation context is restricted.</p>}
          {sensitive && (
            <details>
              <summary className="cursor-pointer">View evaluation</summary>
              <div className="mt-2 space-y-1">
                {summary.normalization?.map(n => (
                  <p key={n.fieldKey}>
                    {n.fieldKey}: {String(n.raw ?? 'Missing')} →{' '}
                    {n.canonical.state === 'RECOGNIZED'
                      ? String(n.canonical.value)
                      : n.canonical.state.toLowerCase()}
                  </p>
                ))}
                {Object.entries(summary.inputContext ?? {}).map(([key, field]) => (
                  <p key={key}>
                    {key}:{' '}
                    {field.state === 'MISSING' ? 'Missing' : String(field.value ?? field.raw)}
                    {field.state === 'UNMAPPED' ? ' (unmapped)' : ''}
                  </p>
                ))}
                {summary.writes?.map((write, i) => (
                  <p key={i}>
                    {write.fieldKey} → {String(write.value)}
                  </p>
                ))}
              </div>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
