'use client';

import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { STATUS_OVERRIDE_VALUES } from '@/lib/status-pages/status-override';
import { describeLocalZone, describeOverrideEffect } from '@/lib/status-pages/override-preview';
import { statusPresentation } from '@/lib/status-pages/status-presentation';

export type StatusPageServiceLayout = 'FLAT' | 'BUSINESS' | 'BUSINESS_EXPANDABLE';

export type BusinessServiceOption = {
  id: string;
  name: string;
  memberServiceIds: string[];
};

/** Per-page presentation of a business service (saved with the page settings). */
export type BusinessServicePageConfig = {
  displayName: string;
  showOnPage: boolean;
  showMembers: boolean;
};

/** Manual component-group status; applied immediately, not with the settings save. */
export type BusinessServiceOverride = { status: string | null; until: string | null };

const DEFAULT_CONFIG: BusinessServicePageConfig = {
  displayName: '',
  showOnPage: true,
  showMembers: true,
};
const COMPUTED = '__computed__';

/** "YYYY-MM-DDTHH:mm" in local time, the value a datetime-local input expects. */
function localInputValue(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Summary row plus a dialog: pin a business service's public status, or clear the pin. */
function OverrideControl({
  name,
  value,
  onApply,
}: {
  name: string;
  value: BusinessServiceOverride;
  onApply: (next: BusinessServiceOverride) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(value.status ?? COMPUTED);
  const [until, setUntil] = useState(localInputValue(value.until));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const zone = browserZone();
  const untilIso = status === COMPUTED || !until ? null : new Date(until).toISOString();
  const dirty = status !== (value.status ?? COMPUTED) || until !== localInputValue(value.until);
  const invalid = status !== COMPUTED && until !== '' && Number.isNaN(new Date(until).getTime());
  const effect = describeOverrideEffect({
    status: status === COMPUTED ? null : status,
    until: untilIso,
    timeZone: zone,
  });
  const current = value.status
    ? describeOverrideEffect({ status: value.status, until: value.until, timeZone: zone })
    : 'Shown automatically from incidents.';
  const submit = async (next: BusinessServiceOverride) => {
    setPending(true);
    const failure = await onApply(next);
    setPending(false);
    setError(failure);
    if (!failure) setOpen(false);
  };
  const reset = (next: boolean) => {
    setOpen(next);
    if (next) {
      setStatus(value.status ?? COMPUTED);
      setUntil(localInputValue(value.until));
      setError(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={cn('text-muted-foreground', value.status && 'font-medium text-foreground')}>
        {current}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={() => reset(true)}>
        {value.status ? 'Change override' : 'Override status'}
        <span className="sr-only"> for {name}</span>
      </Button>
      {value.status && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => submit({ status: null, until: null })}
        >
          Clear<span className="sr-only"> override for {name}</span>
        </Button>
      )}
      <Dialog open={open} onOpenChange={reset}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Override status of {name}</DialogTitle>
            <DialogDescription>
              Pins what visitors see, ignoring incidents, until the end time. Applied immediately,
              not with the settings save.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span className="block">Public status</span>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger
                  className="h-9 w-full text-sm"
                  aria-label={`Public status of ${name}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={COMPUTED}>Automatic (from incidents)</SelectItem>
                  {STATUS_OVERRIDE_VALUES.map(option => (
                    <SelectItem key={option} value={option}>
                      {statusPresentation(option).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {status !== COMPUTED && (
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span className="block">Ends (blank = 30 days)</span>
                <Input
                  type="datetime-local"
                  value={until}
                  onChange={event => setUntil(event.target.value)}
                  className="h-9 text-sm"
                  aria-describedby="override-zone"
                />
                <span id="override-zone" className="block">
                  Your time zone: {describeLocalZone(zone, new Date())}. The page itself shows the
                  end in UTC.
                </span>
              </label>
            )}
            <p
              aria-live="polite"
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground"
            >
              {effect}
            </p>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => reset(false)}>
              Cancel
            </Button>
            {value.status && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => submit({ status: null, until: null })}
              >
                Clear override
              </Button>
            )}
            <Button
              type="button"
              disabled={!dirty || pending || invalid}
              onClick={() =>
                submit({ status: status === COMPUTED ? null : status, until: untilIso })
              }
            >
              {pending ? 'Applying…' : 'Apply now'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One draggable row. The grip is the only drag handle so inputs inside stay usable. */
function SortableRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: (grip: React.ReactNode) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const grip = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Drag to reorder ${label}. Space to pick up, arrow keys to move.`}
      className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
    >
      <GripVertical className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('space-y-2 bg-card px-3 py-2 text-sm', isDragging && 'relative z-10 shadow-md')}
    >
      {children(grip)}
    </li>
  );
}

const LAYOUTS: Array<{ value: StatusPageServiceLayout; title: string; body: string }> = [
  {
    value: 'FLAT',
    title: 'Technical services',
    body: 'One row per service, as today.',
  },
  {
    value: 'BUSINESS',
    title: 'Business services',
    body: 'One row per business service, with its worst status and merged history.',
  },
  {
    value: 'BUSINESS_EXPANDABLE',
    title: 'Business services, expandable',
    body: 'Business service rows that open to show the technical services inside.',
  },
];

/** Layout picker and the ordered business services a status page shows. */
export default function StatusPageBusinessLayout({
  layout,
  onLayoutChange,
  businessServices,
  selectedIds,
  onSelectedIdsChange,
  configs = {},
  onConfigChange,
  overrides = {},
  onOverride,
}: {
  layout: StatusPageServiceLayout;
  onLayoutChange: (layout: StatusPageServiceLayout) => void;
  businessServices: BusinessServiceOption[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  configs?: Record<string, BusinessServicePageConfig>;
  onConfigChange?: (id: string, patch: Partial<BusinessServicePageConfig>) => void;
  /** Saved overrides; only services already saved on the page can be overridden. */
  overrides?: Record<string, BusinessServiceOverride>;
  onOverride?: (id: string, next: BusinessServiceOverride) => Promise<string | null>;
}) {
  const byId = new Map(businessServices.map(item => [item.id, item]));
  const selected = selectedIds.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  const available = businessServices.filter(item => !selectedIds.includes(item.id));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = selectedIds.indexOf(String(active.id));
    const to = selectedIds.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onSelectedIdsChange(arrayMove(selectedIds, from, to));
  };
  const move = (index: number, delta: number) => {
    const next = [...selectedIds];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onSelectedIdsChange(next);
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Layout</h3>
        <p className="text-xs text-muted-foreground">
          How visitors see your services. Grouping never publishes a service that is not on this
          page.
        </p>
      </div>
      <div role="radiogroup" aria-label="Service layout" className="grid gap-2 sm:grid-cols-3">
        {LAYOUTS.map(option => {
          const active = layout === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onLayoutChange(option.value)}
              className={cn(
                'flex min-h-20 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-foreground/30 hover:bg-muted/40'
              )}
            >
              <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
                {option.title}
                {active && <Check className="h-4 w-4 text-primary" aria-hidden />}
              </span>
              <span
                className={cn('text-xs', active ? 'text-foreground/80' : 'text-muted-foreground')}
              >
                {option.body}
              </span>
            </button>
          );
        })}
      </div>

      {layout !== 'FLAT' && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">
              Business services on this page{' '}
              <span className="font-normal text-muted-foreground tabular-nums">
                ({selected.length})
              </span>
            </h3>
            <Link
              href="/services/business"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Manage business services
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Their technical services are added to this page automatically. Hide one in the list
            below to keep it out of the business service&apos;s status. Services in no business
            service appear under &ldquo;Other services&rdquo;.
          </p>
          {businessServices.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No business services exist yet.{' '}
              <Link href="/services/business/new" className="font-medium text-primary underline">
                Create one
              </Link>{' '}
              to group your services.
            </p>
          ) : (
            <>
              {selected.length > 0 && (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={selected.map(item => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ol className="divide-y divide-border rounded-lg border border-border">
                      {selected.map((item, index) => {
                        const config = { ...DEFAULT_CONFIG, ...configs[item.id] };
                        const override = overrides[item.id];
                        return (
                          <SortableRow key={item.id} id={item.id} label={item.name}>
                            {grip => (
                              <>
                                <div className="flex items-center gap-2">
                                  {grip}
                                  <span className="w-5 text-xs text-muted-foreground tabular-nums">
                                    {index + 1}
                                  </span>
                                  <span
                                    className={cn(
                                      'min-w-0 flex-1 truncate font-medium',
                                      !config.showOnPage && 'text-muted-foreground line-through'
                                    )}
                                  >
                                    {item.name}
                                  </span>
                                  <span className="hidden text-xs text-muted-foreground sm:inline tabular-nums">
                                    {item.memberServiceIds.length}{' '}
                                    {item.memberServiceIds.length === 1 ? 'service' : 'services'}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label={`Move ${item.name} up`}
                                    disabled={index === 0}
                                    onClick={() => move(index, -1)}
                                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Move ${item.name} down`}
                                    disabled={index === selected.length - 1}
                                    onClick={() => move(index, 1)}
                                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onSelectedIdsChange(selectedIds.filter(id => id !== item.id))
                                    }
                                    className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                                  >
                                    Remove
                                  </button>
                                </div>
                                {onConfigChange && (
                                  <div className="flex flex-wrap items-end gap-3 pl-7">
                                    <label className="space-y-1 text-xs text-muted-foreground">
                                      <span className="block">Name on page</span>
                                      <Input
                                        value={config.displayName}
                                        placeholder={item.name}
                                        maxLength={200}
                                        onChange={event =>
                                          onConfigChange(item.id, {
                                            displayName: event.target.value,
                                          })
                                        }
                                        className="h-8 w-52 text-xs"
                                        aria-label={`Name of ${item.name} on this page`}
                                      />
                                    </label>
                                    <label className="flex h-8 items-center gap-1.5 text-xs">
                                      <input
                                        type="checkbox"
                                        checked={config.showOnPage}
                                        onChange={event =>
                                          onConfigChange(item.id, {
                                            showOnPage: event.target.checked,
                                          })
                                        }
                                      />
                                      Show on page
                                    </label>
                                    {layout === 'BUSINESS_EXPANDABLE' && (
                                      <label className="flex h-8 items-center gap-1.5 text-xs">
                                        <input
                                          type="checkbox"
                                          checked={config.showMembers}
                                          onChange={event =>
                                            onConfigChange(item.id, {
                                              showMembers: event.target.checked,
                                            })
                                          }
                                        />
                                        List its services
                                      </label>
                                    )}
                                  </div>
                                )}
                                {onOverride && override && (
                                  <div className="pl-7">
                                    <OverrideControl
                                      name={item.name}
                                      value={override}
                                      onApply={next => onOverride(item.id, next)}
                                    />
                                  </div>
                                )}
                              </>
                            )}
                          </SortableRow>
                        );
                      })}
                    </ol>
                  </SortableContext>
                </DndContext>
              )}
              {available.length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label="Add a business service">
                  {available.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectedIdsChange([...selectedIds, item.id])}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      + {item.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
