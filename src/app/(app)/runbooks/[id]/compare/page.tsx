import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { getVersionImpact } from '@/lib/runbooks/version-impact';
import { redactRunbookDisplayName, redactRunbookConfiguration } from '@/lib/runbooks/display-name';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { Badge } from '@/components/ui/shadcn/badge';
export const dynamic = 'force-dynamic';
export default async function VersionComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ base?: string; next?: string; versionsPage?: string }>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const { id } = await params;
  const query = await searchParams;
  const versionsPage = Math.max(1, Math.min(10000, Number(query.versionsPage) || 1));
  const runbook = await prisma.runbook.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 51,
        skip: (Math.floor(versionsPage) - 1) * 50,
        select: { id: true, version: true, state: true },
      },
    },
  });
  if (!runbook) notFound();
  const selection = z.object({ base: z.string().cuid(), next: z.string().cuid() }).safeParse({
    base: query.base ?? runbook.versions[1]?.id,
    next: query.next ?? runbook.versions[0]?.id,
  });
  if (!selection.success)
    return (
      <div className="p-6 space-y-3">
        <RunbookPageHeader
          title="Version comparison"
          description="Publish or save at least two versions to compare changes."
        />
        <Link href={`/runbooks/${id}`}>Back to runbook</Link>
      </div>
    );
  const requestedVersions = await prisma.runbookVersion.findMany({
    where: { runbookId: id, id: { in: [selection.data.base, selection.data.next] } },
    select: { id: true, version: true, state: true },
  });
  if (
    ![selection.data.base, selection.data.next].every(versionId =>
      requestedVersions.some(version => version.id === versionId)
    )
  )
    notFound();
  const selectorVersions = [
    ...new Map(
      [...requestedVersions, ...runbook.versions.slice(0, 50)].map(version => [version.id, version])
    ).values(),
  ];
  const impact = await getVersionImpact(id, selection.data.base, selection.data.next);
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-4">
      <RunbookPageHeader
        title={`${runbook.name} · Version comparison`}
        description={impact.warning}
      />
      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="versionsPage" value={versionsPage} />
        <label>
          Before
          <select
            name="base"
            defaultValue={selection.data.base}
            className="block rounded border p-2 bg-background"
          >
            {selectorVersions.map(version => (
              <option key={version.id} value={version.id}>
                v{version.version} · {version.state}
              </option>
            ))}
          </select>
        </label>
        <label>
          After
          <select
            name="next"
            defaultValue={selection.data.next}
            className="block rounded border p-2 bg-background"
          >
            {selectorVersions.map(version => (
              <option key={version.id} value={version.id}>
                v{version.version} · {version.state}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded border p-2">
          Compare versions
        </button>
      </form>
      <nav aria-label="Version selector pages" className="flex gap-4 text-sm">
        <span>Version page {versionsPage}</span>
        {versionsPage > 1 && (
          <Link
            href={`?base=${selection.data.base}&next=${selection.data.next}&versionsPage=${versionsPage - 1}`}
          >
            Newer versions
          </Link>
        )}
        {runbook.versions.length > 50 && (
          <Link
            href={`?base=${selection.data.base}&next=${selection.data.next}&versionsPage=${versionsPage + 1}`}
          >
            Older versions
          </Link>
        )}
      </nav>
      <section aria-label="Workflow changes" className="space-y-3">
        {impact.steps
          .filter(step => step.change !== 'UNCHANGED')
          .map(step => (
            <article key={step.key} className="rounded-lg border p-4 space-y-2">
              <Badge variant="outline">{step.change}</Badge>
              <h2 className="font-semibold break-words">{step.key}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="font-medium">Before · v{impact.base.version}</h3>
                  <p>
                    {step.before
                      ? `${redactRunbookDisplayName(step.before.name)} · ${step.before.type} · ${step.before.riskClass}`
                      : 'No step'}
                  </p>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(redactRunbookConfiguration(step.before), null, 2)}
                  </pre>
                </div>
                <div>
                  <h3 className="font-medium">After · v{impact.next.version}</h3>
                  <p>
                    {step.after
                      ? `${redactRunbookDisplayName(step.after.name)} · ${step.after.type} · ${step.risk}`
                      : 'Removed'}
                  </p>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(redactRunbookConfiguration(step.after), null, 2)}
                  </pre>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Changes include configuration, prechecks, verification and approval settings;
                credential fields are masked. This comparison performs no operation.
              </p>
            </article>
          ))}
      </section>
      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">Input contract changes</h2>
        <p>Added: {impact.inputKeys.added.join(', ') || 'None'}</p>
        <p>Removed: {impact.inputKeys.removed.join(', ') || 'None'}</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Service rule impact</h2>
        {impact.rulesTruncated && (
          <p role="status">
            Showing the first 500 affected rules. Narrow the service inventory to inspect additional
            rules.
          </p>
        )}
        {impact.rules.map(rule => (
          <div key={rule.id} className="rounded border p-3 flex flex-wrap gap-2">
            <Link
              href={`/services/${rule.serviceId}/automations/${rule.id}`}
              className="text-primary underline"
            >
              {rule.name || rule.id}
            </Link>
            <span>
              {rule.mode} · {rule.enabled ? 'Enabled' : 'Paused'} ·{' '}
              {rule.impact.replaceAll('_', ' ')}
            </span>
          </div>
        ))}
      </section>
      <Link href={`/runbooks/${id}`} className="text-primary underline">
        Back to runbook
      </Link>
    </div>
  );
}
