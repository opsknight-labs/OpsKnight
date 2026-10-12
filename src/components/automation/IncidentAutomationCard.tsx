import IncidentAlertContextCard from './IncidentAlertContextCard';
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
  const notifications = await prisma.notification.groupBy({
    by: ['channel', 'status'],
    where: {
      incidentId,
      eventType: 'triggered',
      channel: { in: ['SLACK', 'MICROSOFT_TEAMS'] },
    },
    _count: { _all: true },
  });
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
    supplementalActions?: Array<{ provider: string }>;
  };
  const version = snapshotSchema.safeParse(decision.version?.snapshot);
  const fields = version.success ? version.data.fields : [];
  const context = summary.enrichedContext ?? summary.inputContext ?? {};
  return (
    <div className="space-y-4">
      <IncidentAlertContextCard
        fields={fields}
        context={context}
        versionNumber={decision.version?.versionNumber}
        sensitive={sensitive}
        omitted={!!summary.diagnosticsOmitted || !!summary.omittedValues?.length}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Automation Decision{' '}
            <Badge variant="outline">Automation · v{decision.version?.versionNumber ?? '—'}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            {decision.matchedRouteRuleName
              ? `Matched rule: ${decision.matchedRouteRuleName}`
              : decision.fallbackReason
                ? 'Automation could not be applied; service-default routing was used.'
                : 'No routing rule matched; service-default routing was used.'}
          </p>
          <p>
            Priority: {decision.basePriority ?? 'Unset'} → {decision.finalPriority ?? 'Unset'}
          </p>
          <p>
            Responder route:{' '}
            {decision.routeType === 'NO_ESCALATION'
              ? 'Personal paging intentionally skipped'
              : (decision.escalationPolicyNameSnapshot ?? 'Service default')}
          </p>
          {decision.fallbackReason && <p>Fallback: {decision.fallbackReason}</p>}
          {sensitive && !!summary.supplementalActions?.length && (
            <p>
              Selected channel actions:{' '}
              {[
                ...new Set(
                  summary.supplementalActions.map(action =>
                    action.provider === 'TEAMS' ? 'Teams' : 'Slack'
                  )
                ),
              ].join(', ')}
              .
            </p>
          )}
          <section
            aria-label="Channel notification status"
            className="rounded-lg border p-3 space-y-1"
          >
            <h3 className="font-medium">Incident channel notifications</h3>
            <p className="text-muted-foreground">
              Current notification records are separate from the routing decision. Provider
              acceptance does not confirm delivery.
            </p>
            {notifications.length ? (
              notifications.map(row => (
                <p key={`${row.channel}:${row.status}`}>
                  {row.channel === 'SLACK' ? 'Slack' : 'Teams'} · {row._count._all} ·{' '}
                  {
                    {
                      PENDING: 'Queued',
                      SENT: 'Accepted by provider',
                      DELIVERED: 'Delivery confirmed',
                      FAILED: 'Failed',
                      SKIPPED: 'Skipped',
                      UNKNOWN: 'Delivery uncertain',
                    }[row.status]
                  }
                </p>
              ))
            ) : (
              <p>No channel notification records are available.</p>
            )}
          </section>
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
