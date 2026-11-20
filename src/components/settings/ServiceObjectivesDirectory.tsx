'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  Lock,
  Pencil,
  Server,
  Target,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import {
  CreateTrigger,
  DirectoryCardGrid,
  DirectoryGuide,
  DirectoryHeader,
  DirectoryTable,
  EmptyState,
  toneClasses,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
  type ToneKey,
} from '@/components/patterns';
import { BADGE_BASE_CLASS, BADGE_SIZE_CLASS } from '@/components/patterns/StatusBadge';
import { ServiceObjectiveForm } from '@/components/settings/ServiceObjectiveForm';
import {
  formatObjectiveTarget,
  formatObjectiveValue,
  formatObjectiveWindow,
  objectiveUnit,
  type ObjectiveHealth,
} from '@/components/settings/serviceObjectiveSummary';

export type ServiceObjectiveItem = {
  id: string;
  lineageId: string;
  version: number;
  name: string;
  description: string | null;
  serviceName: string | null;
  metricType: string;
  target: number;
  comparator: string;
  windowType: string;
  windowValue: number | null;
  health: ObjectiveHealth;
  value: number | null;
  budgetRemaining: number | null;
  /** Server-rendered error budget forecast (burn rate and top consumers), when the viewer may read it. */
  forecast?: ReactNode;
};

const HEALTH: Record<
  ObjectiveHealth,
  { label: string; tone: ToneKey; icon: LucideIcon; hint: string }
> = {
  MEETING: {
    label: 'Meeting target',
    tone: 'ok',
    icon: CheckCircle2,
    hint: 'The latest daily snapshot meets the target.',
  },
  AT_RISK: {
    label: 'At risk',
    tone: 'elevated',
    icon: AlertTriangle,
    hint: 'Meeting the target with under 25% of the error budget left.',
  },
  BREACHED: {
    label: 'Breached',
    tone: 'critical',
    icon: XCircle,
    hint: 'The latest daily snapshot misses the target.',
  },
  NO_DATA: {
    label: 'No data',
    tone: 'neutral',
    icon: CircleDashed,
    hint: 'No measurement in the window. No measurement is not compliance.',
  },
  UNAVAILABLE: {
    label: 'Unavailable',
    tone: 'neutral',
    icon: CircleDashed,
    hint: 'The window is retention-clipped or its telemetry is unsupported.',
  },
  NOT_MEASURED: {
    label: 'Not measured yet',
    tone: 'neutral',
    icon: CircleDashed,
    hint: 'This version has no daily snapshot yet. The scheduler evaluates objectives once a day.',
  },
  RESTRICTED: {
    label: 'Not shared',
    tone: 'neutral',
    icon: Lock,
    hint: 'Shared objective history needs global metric visibility.',
  },
  LEGACY: {
    label: 'Not evaluated',
    tone: 'neutral',
    icon: CircleDashed,
    hint: 'Legacy measurement; evaluation is unavailable.',
  },
};

function HealthBadge({ health }: { health: ObjectiveHealth }) {
  // eslint-disable-next-line security/detect-object-injection -- typed union key
  const meta = HEALTH[health];
  const Icon = meta.icon;
  return (
    <span
      title={meta.hint}
      data-health={health.toLowerCase()}
      className={cn(
        BADGE_BASE_CLASS,
        BADGE_SIZE_CLASS.sm,
        toneClasses(meta.tone === 'neutral' ? null : meta.tone).soft
      )}
    >
      <Icon aria-hidden="true" strokeWidth={2.25} />
      {meta.label}
    </span>
  );
}

function TargetText({ item }: { item: ServiceObjectiveItem }) {
  return (
    <span className="tabular-nums text-foreground">
      {formatObjectiveTarget(item.metricType, item.comparator, item.target)}
      {!objectiveUnit(item.metricType) && (
        <span className="block text-xs text-muted-foreground">
          (legacy target; evaluation unavailable)
        </span>
      )}
    </span>
  );
}

function CurrentValue({ item }: { item: ServiceObjectiveItem }) {
  const value = formatObjectiveValue(item.metricType, item.value);
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        item.health === 'BREACHED' ? toneClasses('critical').text : 'text-foreground'
      )}
    >
      {value}
    </span>
  );
}

/** Compact error-budget meter: bar plus percent left; "—" where no budget applies. */
function BudgetMeter({ item }: { item: ServiceObjectiveItem }) {
  if (item.budgetRemaining === null) {
    return (
      <span
        className="text-muted-foreground"
        title={
          objectiveUnit(item.metricType) === 'minutes'
            ? 'Error budgets apply to percent targets'
            : 'No measured value yet'
        }
      >
        —
      </span>
    );
  }
  const percent = Math.round(item.budgetRemaining * 100);
  const tone =
    item.health === 'BREACHED' ? 'critical' : item.health === 'AT_RISK' ? 'elevated' : 'ok';
  return (
    <span className="inline-flex items-center gap-2">
      <span
        role="meter"
        aria-label="Error budget remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn('block h-full rounded-full', toneClasses(tone).solid)}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
    </span>
  );
}

function definition(item: ServiceObjectiveItem) {
  return {
    id: item.lineageId,
    version: item.version,
    name: item.name,
    description: item.description,
    target: item.target,
    comparator: item.comparator,
    windowType: item.windowType,
    windowValue: item.windowValue,
  };
}

function ObjectiveActions({ item }: { item: ServiceObjectiveItem }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex items-center justify-end gap-0.5">
      {objectiveUnit(item.metricType) && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            aria-label={`Edit objective ${item.name}`}
            title="Edit objective"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Dialog open={editing} onOpenChange={setEditing}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Edit objective</DialogTitle>
                <DialogDescription>
                  {item.name}. Saving creates version {item.version + 1}; earlier versions stay in
                  history.
                </DialogDescription>
              </DialogHeader>
              <ServiceObjectiveForm
                objective={definition(item)}
                onSaved={() => setEditing(false)}
                onCancel={() => setEditing(false)}
              />
            </DialogContent>
          </Dialog>
        </>
      )}
      <ServiceObjectiveForm archive objective={definition(item)} />
    </div>
  );
}

function subtitle(item: ServiceObjectiveItem) {
  return `${item.serviceName ?? 'Workspace'} · ${item.metricType} · Version ${item.version}`;
}

function ObjectiveCell({ item }: { item: ServiceObjectiveItem }) {
  return (
    <div className="min-w-0">
      {/* Description stays one hover away here (and visible in card view) to keep rows dense. */}
      <span
        className="block truncate font-medium text-foreground"
        title={item.description ?? undefined}
      >
        {item.name}
      </span>
      <span className="block truncate text-xs tabular-nums text-muted-foreground">
        {subtitle(item)}
      </span>
    </div>
  );
}

const columns: DirectoryColumn<ServiceObjectiveItem>[] = [
  {
    id: 'objective',
    header: 'Objective',
    sortKey: 'name',
    sortValue: item => item.name,
    className: 'max-w-0 w-[32%]',
    cell: item => <ObjectiveCell item={item} />,
  },
  {
    id: 'target',
    hideable: true,
    header: 'Target',
    sortKey: 'target',
    sortValue: item => item.target,
    className: 'whitespace-nowrap',
    cell: item => <TargetText item={item} />,
  },
  {
    id: 'window',
    hideable: true,
    header: 'Window',
    className: 'hidden whitespace-nowrap md:table-cell',
    cell: item => formatObjectiveWindow(item.windowType, item.windowValue),
  },
  {
    id: 'current',
    hideable: true,
    header: 'Current',
    className: 'hidden whitespace-nowrap lg:table-cell',
    cell: item => <CurrentValue item={item} />,
  },
  {
    id: 'budget',
    hideable: true,
    header: 'Error budget',
    sortKey: 'budget',
    sortValue: item => item.budgetRemaining,
    className: 'hidden whitespace-nowrap lg:table-cell',
    cell: item => <BudgetMeter item={item} />,
  },
  { id: 'status', header: 'Status', cell: item => <HealthBadge health={item.health} /> },
];

function mobileRow(item: ServiceObjectiveItem) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="truncate font-medium text-foreground">{item.name}</p>
      <p className="truncate text-xs text-muted-foreground">{subtitle(item)}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <HealthBadge health={item.health} />
        <TargetText item={item} />
        <span aria-hidden="true">·</span>
        <span>{formatObjectiveWindow(item.windowType, item.windowValue)}</span>
        {item.value !== null && (
          <>
            <span aria-hidden="true">·</span>
            <CurrentValue item={item} />
          </>
        )}
        {item.budgetRemaining !== null && <BudgetMeter item={item} />}
      </div>
    </div>
  );
}

function ObjectiveCard({ item, admin }: { item: ServiceObjectiveItem; admin: boolean }) {
  const tone = HEALTH[item.health].tone;
  return (
    <div
      className={cn(
        'rounded-lg border border-l-4 border-border bg-card p-3',
        tone === 'neutral' ? 'border-l-border' : toneClasses(tone).borderLeft
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{item.name}</h3>
          <HealthBadge health={item.health} />
        </div>
        {admin && (
          <div className="-mr-1 -mt-1">
            <ObjectiveActions item={item} />
          </div>
        )}
      </div>
      <p className="mt-1.5 truncate text-xs tabular-nums text-muted-foreground">{subtitle(item)}</p>
      {item.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Target</dt>
          <dd>
            <TargetText item={item} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Window</dt>
          <dd className="text-foreground">
            {formatObjectiveWindow(item.windowType, item.windowValue)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Current</dt>
          <dd>
            <CurrentValue item={item} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Error budget</dt>
          <dd>
            <BudgetMeter item={item} />
          </dd>
        </div>
      </dl>
      {item.forecast && <div className="mt-3">{item.forecast}</div>}
    </div>
  );
}

const GUIDE_STEPS = [
  {
    title: 'Pick a measurement',
    description:
      'Uptime and availability are percent targets for one service. MTTA and MTTR are minute targets for a service or the whole workspace.',
  },
  {
    title: 'Set the target and window',
    description:
      'Choose at least or at most, the value, and a rolling window. Windows count elapsed days, not calendar periods.',
  },
  {
    title: 'Read the daily snapshot',
    description:
      'The scheduler evaluates each active objective once a day. Status and error budget come from the latest snapshot; under 25% budget left reads as at risk.',
  },
  {
    title: 'Edit or archive',
    description:
      'Saving an edit creates a new version. Archiving retires the objective; earlier versions and measurements stay available through the API.',
  },
];

const GUIDE_LINKS = [
  {
    label: 'Services',
    href: '/services',
    icon: <Server className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    label: 'Analytics',
    href: '/insights',
    icon: <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />,
  },
];

/** Admin-only "Create New Objective" row that expands into the create form. */
export function ServiceObjectiveCreate() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <CreateTrigger
        title="Create New Objective"
        description="Add an uptime, availability, MTTA or MTTR target. Saving creates version 1."
        onClick={() => setOpen(true)}
      />
    );
  }
  return (
    <Card className="border-primary/20 shadow-sm">
      <CardHeader className="space-y-1 pb-4">
        <h2 className="text-base font-semibold text-foreground">Create objective</h2>
        <p className="text-xs text-muted-foreground">
          Add a target for a service. Saving creates version 1; later edits create new versions.
        </p>
      </CardHeader>
      <CardContent>
        <ServiceObjectiveForm onSaved={() => setOpen(false)} onCancel={() => setOpen(false)} />
      </CardContent>
    </Card>
  );
}

export function ServiceObjectivesDirectory({
  items,
  admin,
  total,
  nextHref,
}: {
  items: ServiceObjectiveItem[];
  admin: boolean;
  /** Display total, e.g. "25+" when another page exists. */
  total: string;
  nextHref: string | null;
}) {
  const [view, setView] = useDirectoryView('service-objectives');
  const columnVisibility = useDirectoryColumns('service-objectives', columns);
  return (
    <section
      aria-labelledby="active-objectives-heading"
      className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <DirectoryHeader
        title={<span id="active-objectives-heading">Active objectives</span>}
        summary={`${total} ${total === '1' ? 'objective' : 'objectives'}`}
        columns={columnVisibility}
        density
        view={{ value: view, onChange: setView }}
        guide={
          <DirectoryGuide
            title="How service objectives work"
            steps={GUIDE_STEPS}
            links={GUIDE_LINKS}
          />
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<Target className="h-6 w-6 text-muted-foreground" />}
          title="No active objectives in your accessible services."
          description={
            admin
              ? 'Use Create New Objective above to start tracking an uptime or response-time target.'
              : 'Objectives appear here once an administrator defines them for your services.'
          }
          variant="simple"
          primaryAction={
            <Button asChild variant="outline" size="sm">
              <Link href="/services">Browse services</Link>
            </Button>
          }
        />
      ) : view === 'table' ? (
        <DirectoryTable
          rows={items}
          getRowId={item => item.id}
          columns={columns}
          hiddenColumns={columnVisibility.hidden}
          label="Service objectives"
          rowActions={admin ? item => <ObjectiveActions item={item} /> : undefined}
          mobileRow={mobileRow}
        />
      ) : (
        <DirectoryCardGrid>
          {items.map(item => (
            <ObjectiveCard key={item.id} item={item} admin={admin} />
          ))}
        </DirectoryCardGrid>
      )}
      {nextHref && (
        <nav
          aria-label="Objective pages"
          className="flex justify-end border-t border-border px-4 py-2.5"
        >
          <Button asChild variant="outline" size="sm">
            <Link href={nextHref}>Next objectives</Link>
          </Button>
        </nav>
      )}
    </section>
  );
}
