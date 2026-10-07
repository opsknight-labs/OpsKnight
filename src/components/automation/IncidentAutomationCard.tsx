import prisma from '@/lib/prisma';
import { assertCanViewIncident } from '@/lib/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
export default async function IncidentAutomationCard({ incidentId }: { incidentId: string }) {
  await assertCanViewIncident(incidentId);
  const decision = await prisma.incidentAutomationDecision.findUnique({
    where: { incidentId },
    include: { version: { select: { versionNumber: true } } },
  });
  if (!decision) return null;
  const summary = decision.summary as {
    inputContext?: Record<string, { state: string; value?: unknown; raw?: unknown }>;
    enrichedContext?: Record<string, { state: string; value?: unknown; raw?: unknown }>;
    normalization?: Array<{
      fieldKey: string;
      raw: unknown;
      canonical: { state: string; value?: unknown };
    }>;
    writes?: Array<{ fieldKey: string; value: unknown }>;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Why was I paged?{' '}
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
                {key}: {field.state === 'MISSING' ? 'Missing' : String(field.value ?? field.raw)}
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
      </CardContent>
    </Card>
  );
}
