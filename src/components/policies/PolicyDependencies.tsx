import prisma from '@/lib/prisma';
import { assertCanViewPolicy } from '@/lib/rbac';
import { setPolicyArchived } from '@/app/(app)/policies/actions';
import { snapshotSchema } from '@/lib/automation/contract';
import { Button } from '@/components/ui/shadcn/button';
export default async function PolicyDependencies({
  policyId,
  archived,
  canManage,
  mobile = false,
}: {
  policyId: string;
  archived: boolean;
  canManage: boolean;
  mobile?: boolean;
}) {
  await assertCanViewPolicy(policyId);
  const [services, refs, pinned] = await Promise.all([
    prisma.service.findMany({
      where: { escalationPolicyId: policyId },
      select: { id: true, name: true },
    }),
    prisma.automationVersionPolicyRef.findMany({
      where: { escalationPolicyId: policyId },
      select: {
        versionId: true,
        version: {
          select: {
            serviceId: true,
            versionNumber: true,
            snapshot: true,
            service: { select: { id: true, name: true } },
            activeConfig: { select: { serviceId: true } },
          },
        },
      },
    }),
    prisma.incidentAutomationDecision.count({ where: { escalationPolicyId: policyId } }),
  ]);
  const active = refs.filter(r => r.version.activeConfig);
  return (
    <section className="rounded-xl border p-4 space-y-4">
      <h2 className="font-semibold">Policy Dependencies · {archived ? 'Archived' : 'Active'}</h2>
      <p>
        {services.length} service defaults · {active.length} active versions ·{' '}
        {refs.length - active.length} historical versions · {pinned} pinned incident decisions
      </p>
      <ul className="space-y-2">
        {services.map(s => (
          <li key={s.id}>
            <a className="underline" href={`/services/${s.id}`}>
              {s.name} · Default policy
            </a>
          </li>
        ))}
        {refs.map(r => {
          const parsed = snapshotSchema.safeParse(r.version.snapshot);
          const rules = parsed.success
            ? parsed.data.rules.filter(rule =>
                rule.actions.some(
                  a => a.type === 'USE_ESCALATION_POLICY' && a.policyId === policyId
                )
              )
            : [];
          return (
            <li key={r.versionId}>
              <a
                className="underline"
                href={
                  mobile
                    ? `/m/services/${r.version.serviceId}/automation`
                    : `/services/${r.version.serviceId}?tab=automation`
                }
              >
                {r.version.service.name} · v{r.version.versionNumber}
              </a>{' '}
              · {r.version.activeConfig ? 'Current' : 'Historical, immutable'}
              <ul>
                {rules.map(rule => (
                  <li key={rule.id}>
                    {rule.name} · {rule.enabled ? 'Enabled' : 'Disabled'}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted-foreground">
        Archive hides this policy from new routing choices while preserving historical escalation.
        Replace every current reference before archiving. Publishing a replacement does not make
        historical references deletable.
      </p>
      {canManage && (
        <form
          action={async () => {
            'use server';
            await setPolicyArchived(policyId, !archived);
          }}
        >
          <Button
            variant="outline"
            disabled={!archived && (services.length > 0 || active.length > 0)}
          >
            {archived ? 'Restore policy' : 'Archive policy'}
          </Button>
        </form>
      )}
    </section>
  );
}
