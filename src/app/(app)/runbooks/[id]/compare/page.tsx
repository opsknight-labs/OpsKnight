import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { getVersionImpact } from '@/lib/runbooks/version-impact';
import { redactRunbookDisplayName, redactRunbookConfiguration } from '@/lib/runbooks/display-name';
import {
  ArrowLeft,
  ArrowRight,
  GitCompare,
  Layers,
  Minus,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { EmptyHint, Pill, SectionCard } from '@/components/runbooks/ui/primitives';
import { nativeSelectClassName } from '@/components/runbooks/detail/RunbookDetailsSheet';
import {
  VersionStepDiff,
  type StepChange,
  type StepDiffItem,
} from '@/components/runbooks/detail/VersionStepDiff';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
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
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <RunbookPageHeader
          breadcrumbs={[
            { label: 'Runbooks', href: '/runbooks' },
            { label: runbook.name, href: `/runbooks/${id}?tab=versions` },
            { label: 'Compare' },
          ]}
          title="Version comparison"
        />
        <EmptyHint
          icon={GitCompare}
          title="Nothing to compare yet"
          description="Save or publish at least two versions of this runbook to compare changes."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`/runbooks/${id}`}>Back to runbook</Link>
            </Button>
          }
        />
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
  const describeStep = (
    step: (typeof impact.steps)[number]['before'],
    risk: string | null | undefined
  ) =>
    step
      ? {
          summary: `${redactRunbookDisplayName(step.name)} · ${step.type} · ${risk ?? step.riskClass}`,
          configuration: JSON.stringify(redactRunbookConfiguration(step), null, 2),
        }
      : null;
  const diffSteps: StepDiffItem[] = impact.steps.map(step => ({
    key: step.key,
    change: step.change as StepChange,
    before: describeStep(step.before, step.before?.riskClass),
    after: describeStep(step.after, step.risk),
  }));
  const pageHref = (page: number) =>
    `?base=${selection.data.base}&next=${selection.data.next}&versionsPage=${page}`;
  const versionOptions = selectorVersions.map(version => (
    <option key={version.id} value={version.id}>
      v{version.version} · {version.state}
    </option>
  ));
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <RunbookPageHeader
        breadcrumbs={[
          { label: 'Runbooks', href: '/runbooks' },
          { label: runbook.name, href: `/runbooks/${id}?tab=versions` },
          { label: 'Compare' },
        ]}
        title={`${runbook.name} · Version comparison`}
        description={impact.warning}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/runbooks/${id}?tab=versions`}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to runbook
            </Link>
          </Button>
        }
      />
      <section
        aria-label="Choose versions"
        className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs lg:flex-row lg:items-end lg:justify-between"
      >
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:items-end">
          <input type="hidden" name="versionsPage" value={versionsPage} />
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
              Before
            </span>
            <select
              name="base"
              defaultValue={selection.data.base}
              className={cn(nativeSelectClassName, 'min-w-44 text-foreground')}
            >
              {versionOptions}
            </select>
          </label>
          <ArrowRight
            className="mb-2.5 hidden h-4 w-4 text-muted-foreground sm:block"
            aria-hidden="true"
          />
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              After
            </span>
            <select
              name="next"
              defaultValue={selection.data.next}
              className={cn(nativeSelectClassName, 'min-w-44 text-foreground')}
            >
              {versionOptions}
            </select>
          </label>
          <Button type="submit" size="sm" className="h-9">
            <GitCompare className="h-4 w-4" aria-hidden="true" />
            Compare versions
          </Button>
        </form>
        <nav
          aria-label="Version selector pages"
          className="flex items-center gap-3 text-xs text-muted-foreground"
        >
          <span>Version page {versionsPage}</span>
          {versionsPage > 1 && (
            <Link
              className="font-medium text-primary hover:underline"
              href={pageHref(versionsPage - 1)}
            >
              Newer versions
            </Link>
          )}
          {runbook.versions.length > 50 && (
            <Link
              className="font-medium text-primary hover:underline"
              href={pageHref(versionsPage + 1)}
            >
              Older versions
            </Link>
          )}
        </nav>
      </section>
      <div
        aria-hidden="true"
        className={cn(
          'hidden grid-cols-2 gap-3 px-4 text-xs font-medium text-muted-foreground',
          diffSteps.some(step => step.change !== 'UNCHANGED') && 'md:grid'
        )}
      >
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
          Before · v{impact.base.version}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          After · v{impact.next.version}
        </span>
      </div>
      <VersionStepDiff
        steps={diffSteps}
        baseVersion={impact.base.version}
        nextVersion={impact.next.version}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title={<span id="input-contract-heading">Input contract changes</span>}
          description="Rules that pass removed inputs, or don’t pass new required ones, need review."
          icon={SlidersHorizontal}
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Added</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {impact.inputKeys.added.length ? (
                  impact.inputKeys.added.map(key => (
                    <Pill key={key} tone="success" icon={Plus} className="font-mono">
                      {key}
                    </Pill>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">None</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Removed</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {impact.inputKeys.removed.length ? (
                  impact.inputKeys.removed.map(key => (
                    <Pill key={key} tone="danger" icon={Minus} className="font-mono">
                      {key}
                    </Pill>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">None</span>
                )}
              </dd>
            </div>
          </dl>
        </SectionCard>
        <SectionCard
          title={<span id="rule-impact-heading">Service rule impact</span>}
          description="Automation rules that will run the newer version, and how they’re affected."
          icon={Layers}
          bodyClassName="p-0"
        >
          {impact.rulesTruncated && (
            <p role="status" className="border-b px-5 py-2.5 text-xs text-muted-foreground">
              Showing the first 500 affected rules. Narrow the service inventory to inspect
              additional rules.
            </p>
          )}
          {impact.rules.length === 0 ? (
            <div className="p-5">
              <EmptyHint
                icon={Layers}
                title="No service rules use this runbook"
                description="Publishing is safe for services; nothing runs it automatically yet."
              />
            </div>
          ) : (
            <ul className="max-h-[480px] divide-y overflow-y-auto">
              {impact.rules.map(rule => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                >
                  <Link
                    href={`/services/${rule.serviceId}/automations/${rule.id}`}
                    className="min-w-0 truncate text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                  >
                    {rule.name || rule.id}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Pill>{rule.mode}</Pill>
                    <Pill tone={rule.enabled ? 'success' : 'neutral'}>
                      {rule.enabled ? 'Enabled' : 'Paused'}
                    </Pill>
                    <Pill>{rule.impact.replaceAll('_', ' ').toLowerCase()}</Pill>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
