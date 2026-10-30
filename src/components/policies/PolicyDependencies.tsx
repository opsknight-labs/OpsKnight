import prisma from '@/lib/prisma';
import { assertCanViewPolicy } from '@/lib/rbac';
import PolicyArchiveControl from './PolicyArchiveControl';
import { z } from 'zod/v3';

export default async function PolicyDependencies({
  policyId,
  archived,
  canManage,
  mobile = false,
  page = 1,
}: {
  policyId: string;
  archived: boolean;
  canManage: boolean;
  mobile?: boolean;
  page?: number;
}) {
  await assertCanViewPolicy(policyId);
  const currentPage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
  const take = 20;
  const skip = (currentPage - 1) * take;
  const currentWhere = { escalationPolicyId: policyId, version: { activeConfig: { isNot: null } } };
  const historyWhere = { escalationPolicyId: policyId, version: { activeConfig: { is: null } } };
  const selection = {
    versionId: true,
    ruleReferences: true,
    version: {
      select: {
        serviceId: true,
        versionNumber: true,
        service: { select: { id: true, name: true } },
        activeConfig: { select: { serviceId: true } },
      },
    },
  } as const;
  const [services, current, history, serviceCount, currentCount, historyCount, pinned] =
    await Promise.all([
      prisma.service.findMany({
        where: { escalationPolicyId: policyId },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
        take,
        skip,
      }),
      prisma.automationVersionPolicyRef.findMany({
        where: currentWhere,
        select: selection,
        orderBy: { versionId: 'asc' },
        take,
        skip,
      }),
      prisma.automationVersionPolicyRef.findMany({
        where: historyWhere,
        select: selection,
        orderBy: { versionId: 'asc' },
        take,
        skip,
      }),
      prisma.service.count({ where: { escalationPolicyId: policyId } }),
      prisma.automationVersionPolicyRef.count({ where: currentWhere }),
      prisma.automationVersionPolicyRef.count({ where: historyWhere }),
      prisma.incidentAutomationDecision.count({ where: { escalationPolicyId: policyId } }),
    ]);
  const refs = [...current, ...history];
  const ruleSchema = z.array(z.object({ id: z.string(), name: z.string(), enabled: z.boolean() }));
  const href = (value: number) =>
    `${mobile ? '/m' : ''}/policies/${policyId}?tab=dependencies&depPage=${value}`;
  const hasMore = Math.max(serviceCount, currentCount, historyCount) > skip + take;
  return (
    <section className="min-w-0 break-words rounded-xl border p-4 space-y-4">
      <h2 className="font-semibold">Policy Dependencies · {archived ? 'Archived' : 'Active'}</h2>
      <p>
        {serviceCount} service defaults · {currentCount} active versions · {historyCount} historical
        versions · {pinned} pinned incident decisions
      </p>
      <ul className="space-y-2">
        {services.map(s => (
          <li key={s.id}>
            <a className="underline" href={`${mobile ? '/m' : ''}/services/${s.id}`}>
              {s.name} · Default policy
            </a>
          </li>
        ))}
        {refs.map(r => {
          const parsed = ruleSchema.safeParse(r.ruleReferences);
          const rules = parsed.success ? parsed.data : [];
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
      <nav aria-label="Dependency pages" className="flex gap-4 text-sm">
        {currentPage > 1 && (
          <a className="underline" href={href(currentPage - 1)}>
            Previous dependencies
          </a>
        )}
        <span>Page {currentPage} · Up to 20 references per category</span>
        {hasMore && (
          <a className="underline" href={href(currentPage + 1)}>
            More dependencies
          </a>
        )}
      </nav>
      {canManage && (
        <PolicyArchiveControl
          policyId={policyId}
          archived={archived}
          blocked={serviceCount > 0 || currentCount > 0}
        />
      )}
    </section>
  );
}
