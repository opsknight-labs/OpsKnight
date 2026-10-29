import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod/v3';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { getVersionImpact } from '@/lib/runbooks/version-impact';
import { redactRunbookDisplayName, redactRunbookConfiguration } from '@/lib/runbooks/display-name';
import {
  ArrowLeft,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  GitCompare,
  Layers,
  Minus,
  Plus,
  Server,
  SlidersHorizontal,
} from 'lucide-react';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { EmptyHint, Pill, SectionCard } from '@/components/runbooks/ui/primitives';
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

  if (!selection.success) {
    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
        <RunbookPageHeader
          breadcrumbs={[
            { label: 'Runbooks', href: '/runbooks' },
            { label: runbook.name, href: `/runbooks/${id}?tab=versions` },
            { label: 'Compare' },
          ]}
          title={`${runbook.name} · Version comparison`}
        />
        <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-8 shadow-xs">
          <EmptyHint
            icon={GitCompare}
            title="Nothing to compare yet"
            description="Save or publish at least two versions of this runbook to compare changes."
            action={
              <Button
                asChild
                size="sm"
                className="h-8 gap-1.5 rounded-xl bg-foreground text-background hover:bg-foreground/90 font-medium shadow-xs text-xs"
              >
                <Link href={`/runbooks/${id}`}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to runbook
                </Link>
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const requestedVersions = await prisma.runbookVersion.findMany({
    where: { runbookId: id, id: { in: [selection.data.base, selection.data.next] } },
    select: { id: true, version: true, state: true },
  });

  if (
    ![selection.data.base, selection.data.next].every(versionId =>
      requestedVersions.some(version => version.id === versionId)
    )
  ) {
    notFound();
  }

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
          name: redactRunbookDisplayName(step.name),
          type: step.type,
          risk: risk ?? step.riskClass,
          description: step.description,
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

  const swapHref = `?base=${selection.data.next}&next=${selection.data.base}&versionsPage=${versionsPage}`;

  const versionOptions = selectorVersions.map(version => (
    <option key={version.id} value={version.id}>
      v{version.version} · {version.state}
    </option>
  ));

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 pt-6 pb-16 md:px-6 md:py-8">
      {/* Page Header */}
      <RunbookPageHeader
        breadcrumbs={[
          { label: 'Runbooks', href: '/runbooks' },
          { label: runbook.name, href: `/runbooks/${id}?tab=versions` },
          { label: 'Compare' },
        ]}
        title={`${runbook.name} · Version comparison`}
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            v{impact.base.version} → v{impact.next.version}
          </span>
        }
        description={impact.warning}
        actions={
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-xl border-border/80 text-xs font-medium shadow-2xs hover:bg-accent/60"
          >
            <Link href={`/runbooks/${id}?tab=versions`}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to runbook
            </Link>
          </Button>
        }
      />

      {/* Version Selector Card */}
      <section
        aria-label="Choose versions"
        className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-center flex-wrap">
            <input type="hidden" name="versionsPage" value={versionsPage} />

            {/* Before (Base) Selector */}
            <div className="w-full sm:w-auto space-y-1">
              <label
                htmlFor="base-select"
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
              >
                <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
                Before (Base)
              </label>
              <div className="relative">
                <select
                  id="base-select"
                  name="base"
                  defaultValue={selection.data.base}
                  className="h-9 w-full sm:min-w-48 appearance-none rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 pl-3 pr-8 py-1.5 text-xs font-medium text-foreground shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
                >
                  {versionOptions}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            </div>

            {/* Swap Button (Desktop / Tablet) */}
            <div className="hidden sm:flex self-end mb-0.5">
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl border border-border/80 text-muted-foreground hover:text-foreground hover:bg-accent/60 shadow-2xs"
                title="Swap before and after versions"
              >
                <Link href={swapHref}>
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">Swap versions</span>
                </Link>
              </Button>
            </div>

            {/* Swap Button (Mobile) */}
            <div className="flex sm:hidden justify-center -my-1">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-7 px-2.5 rounded-lg border-border/70 text-[11px] text-muted-foreground hover:text-foreground gap-1.5"
              >
                <Link href={swapHref}>
                  <ArrowLeftRight className="h-3 w-3" />
                  Swap before & after
                </Link>
              </Button>
            </div>

            {/* After (Target) Selector */}
            <div className="w-full sm:w-auto space-y-1">
              <label
                htmlFor="next-select"
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                After (Target)
              </label>
              <div className="relative">
                <select
                  id="next-select"
                  name="next"
                  defaultValue={selection.data.next}
                  className="h-9 w-full sm:min-w-48 appearance-none rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 pl-3 pr-8 py-1.5 text-xs font-medium text-foreground shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
                >
                  {versionOptions}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="w-full sm:w-auto self-end mb-0.5 pt-1 sm:pt-0">
              <Button
                type="submit"
                size="sm"
                className="h-9 w-full sm:w-auto rounded-xl bg-foreground text-background hover:bg-foreground/90 text-xs font-medium shadow-xs gap-1.5 justify-center"
              >
                <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                Compare versions
              </Button>
            </div>
          </form>

          {/* Version Pagination Nav */}
          <nav
            aria-label="Version selector pages"
            className="flex items-center gap-2.5 text-xs text-muted-foreground pt-1 lg:pt-0 border-t border-border/40 lg:border-t-0"
          >
            <span className="tabular-nums font-medium">Version page {versionsPage}</span>
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
        </div>
      </section>

      {/* Column Indicator Bar for Desktop */}
      <div
        aria-hidden="true"
        className={cn(
          'hidden grid-cols-2 gap-3 px-2 text-xs font-semibold text-muted-foreground',
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

      {/* Step Differences Main Component */}
      <VersionStepDiff
        steps={diffSteps}
        baseVersion={impact.base.version}
        nextVersion={impact.next.version}
      />

      {/* Bottom Cards: Input Contract & Service Rule Impact */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Input Contract Changes */}
        <SectionCard
          title={<span id="input-contract-heading">Input contract changes</span>}
          description="Rules that pass removed inputs, or don’t pass new required ones, need review."
          icon={SlidersHorizontal}
        >
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Added Inputs</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  +{impact.inputKeys.added.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {impact.inputKeys.added.length ? (
                  impact.inputKeys.added.map(key => (
                    <Pill key={key} tone="success" icon={Plus} className="font-mono">
                      {key}
                    </Pill>
                  ))
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    None · No new inputs required
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Removed Inputs</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  -{impact.inputKeys.removed.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {impact.inputKeys.removed.length ? (
                  impact.inputKeys.removed.map(key => (
                    <Pill key={key} tone="danger" icon={Minus} className="font-mono">
                      {key}
                    </Pill>
                  ))
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    None · Existing bindings unaffected
                  </span>
                )}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Service Rule Impact */}
        <SectionCard
          title={<span id="rule-impact-heading">Service rule impact</span>}
          description="Automation rules that will run the newer version, and how they’re affected."
          icon={Layers}
          bodyClassName="p-0"
        >
          {impact.rulesTruncated && (
            <p
              role="status"
              className="border-b border-border/60 px-5 py-2.5 text-xs text-muted-foreground"
            >
              Showing the first 500 affected rules. Narrow the service inventory to inspect
              additional rules.
            </p>
          )}
          {impact.rules.length === 0 ? (
            <div className="p-6">
              <EmptyHint
                icon={Layers}
                title="No service rules use this runbook"
                description="Publishing is safe for services; nothing runs it automatically yet."
              />
            </div>
          ) : (
            <ul className="max-h-[480px] divide-y divide-border/60 overflow-y-auto">
              {(
                impact.rules as Array<{
                  id: string;
                  name: string;
                  serviceId: string;
                  enabled: boolean;
                  mode: string;
                  versionStrategy: string;
                  service?: { id: string; name: string } | null;
                  impact: string;
                }>
              ).map(rule => (
                <li
                  key={rule.id}
                  className="flex flex-col gap-2.5 px-5 py-3.5 transition-colors hover:bg-accent/30 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <Link
                        href={`/services/${rule.serviceId}/automations/${rule.id}`}
                        className="truncate text-xs font-semibold text-foreground hover:text-primary transition-colors hover:underline"
                      >
                        {rule.name || `Rule #${rule.id.slice(-6)}`}
                      </Link>
                      {rule.service?.name && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <Server className="h-3 w-3 text-muted-foreground" />
                          {rule.service.name}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Strategy:{' '}
                      <span className="font-mono font-medium text-foreground">
                        {rule.versionStrategy === 'LATEST_PUBLISHED'
                          ? 'Tracks latest publication'
                          : 'Pinned version'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <Pill tone="neutral">{rule.mode}</Pill>
                    <Pill tone={rule.enabled ? 'success' : 'neutral'}>
                      {rule.enabled ? 'Enabled' : 'Paused'}
                    </Pill>
                    <Pill tone={rule.impact === 'TRACKS_NEW_PUBLICATION' ? 'warning' : 'neutral'}>
                      {rule.impact.replaceAll('_', ' ').toLowerCase()}
                    </Pill>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
