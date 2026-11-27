'use client';
/* eslint-disable security/detect-object-injection -- lookups by ids from the page's own props */

import { useRef, useState } from 'react';
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
import { Switch } from '@/components/ui/shadcn/switch';
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
import { buildBusinessHierarchy } from '@/lib/status-pages/business-hierarchy';

export type StatusPageServiceLayout = 'FLAT' | 'BUSINESS' | 'BUSINESS_EXPANDABLE';

export type BusinessServiceOption = {
  id: string;
  name: string;
  memberServiceIds: string[];
  /** Business services this one supports (its parents in the support hierarchy). */
  parentIds?: string[];
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
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
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
      className={cn(
        'space-y-2 bg-card px-3 py-2 text-sm',
        isDragging && 'relative z-10 shadow-md',
        className
      )}
    >
      {children(grip)}
    </li>
  );
}

/** Up/down buttons beside a drag grip, for keyboard and touch users. */
function MoveButtons({
  name,
  index,
  count,
  onMove,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (delta: number) => void;
}) {
  const style =
    'rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30';
  return (
    <>
      <button
        type="button"
        aria-label={`Move ${name} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className={style}
      >
        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Move ${name} down`}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        className={style}
      >
        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
      </button>
    </>
  );
}

/** A labelled house Switch; the label is a separate element so the switch keeps its own role. */
function SwitchField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span className="flex h-8 items-center gap-1.5 text-xs">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id}>{label}</label>
    </span>
  );
}

/** A technical service as the tree editor shows it under its business services. */
export type BusinessLayoutMember = {
  name: string;
  /** Shown on this page (StatusPageService.showOnPage). */
  shown: boolean;
  /** Position in the page's service order; members are listed in this order. */
  position: number;
};

/** A group's members on this page, in page order. */
function MemberList({
  group,
  memberIds,
  members,
  onShownChange,
  onReorder,
}: {
  group: string;
  memberIds: string[];
  members: Record<string, BusinessLayoutMember>;
  onShownChange?: (serviceId: string, shown: boolean) => void;
  onReorder?: (orderedIds: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  if (!memberIds.length) return null;
  const move = (index: number, delta: number) =>
    onReorder?.(arrayMove(memberIds, index, index + delta));
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const from = memberIds.indexOf(String(active.id));
        const to = memberIds.indexOf(String(over.id));
        if (from >= 0 && to >= 0) onReorder?.(arrayMove(memberIds, from, to));
      }}
    >
      <SortableContext items={memberIds} strategy={verticalListSortingStrategy}>
        <ol
          aria-label={`Services in ${group}`}
          className="ml-7 divide-y divide-border rounded-md border border-border"
        >
          {memberIds.map((id, index) => {
            const member = members[id];
            return (
              <SortableRow key={id} id={id} label={member.name} className="py-1.5 text-xs">
                {grip => (
                  <div className="flex items-center gap-2">
                    {grip}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        !member.shown && 'text-muted-foreground line-through'
                      )}
                    >
                      {member.name}
                    </span>
                    {onReorder && (
                      <MoveButtons
                        name={member.name}
                        index={index}
                        count={memberIds.length}
                        onMove={delta => move(index, delta)}
                      />
                    )}
                    {onShownChange && (
                      <Switch
                        checked={member.shown}
                        onCheckedChange={checked => onShownChange(id, checked)}
                        aria-label={`Show ${member.name} on this page`}
                      />
                    )}
                  </div>
                )}
              </SortableRow>
            );
          })}
        </ol>
      </SortableContext>
    </DndContext>
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
    title: 'Business services only (services hidden)',
    body: 'One row per business service, with its worst status and merged history.',
  },
  {
    value: 'BUSINESS_EXPANDABLE',
    title: 'Business services, expandable',
    body: 'Business service rows that open to show the technical services inside.',
  },
];

// Child business services are indented by their depth in the support hierarchy.
const DEPTH_INDENT = ['', 'pl-8', 'pl-14'];

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
  expandGroupsByDefault = false,
  onExpandGroupsByDefaultChange,
  members = {},
  onMemberShownChange,
  onMembersReorder,
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
  expandGroupsByDefault?: boolean;
  onExpandGroupsByDefaultChange?: (value: boolean) => void;
  /** Services on this page, keyed by id; a group lists the ones it contains. */
  members?: Record<string, BusinessLayoutMember>;
  onMemberShownChange?: (serviceId: string, shown: boolean) => void;
  /** A group's members in their new order (drag or arrow buttons). */
  onMembersReorder?: (businessServiceId: string, orderedIds: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const radios = useRef<Array<HTMLButtonElement | null>>([]);
  const byId = new Map(businessServices.map(item => [item.id, item]));
  const selected = selectedIds.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  const available = businessServices.filter(item => !selectedIds.includes(item.id));
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? available.filter(item => item.name.toLowerCase().includes(needle))
    : available;
  const hierarchy = buildBusinessHierarchy(
    selected.map(item => item.id),
    selected.flatMap(item =>
      (item.parentIds ?? []).map(parentId => ({ parentId, childId: item.id }))
    )
  );
  const depthOf = (id: string) => {
    let depth = 0;
    for (let at = hierarchy.get(id)?.parentId; at && depth < 2; at = hierarchy.get(at)?.parentId)
      depth++;
    return depth;
  };
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
  const activeIndex = Math.max(
    0,
    LAYOUTS.findIndex(option => option.value === layout)
  );
  // Radio group keyboard model: one tab stop, arrow keys move and select.
  const onRadioKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = LAYOUTS.length - 1;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onLayoutChange(LAYOUTS[next].value);
    radios.current[next]?.focus();
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
        {LAYOUTS.map((option, index) => {
          const active = layout === option.value;
          return (
            <button
              key={option.value}
              ref={node => {
                radios.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => onLayoutChange(option.value)}
              onKeyDown={event => onRadioKeyDown(event, index)}
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

      {layout === 'BUSINESS_EXPANDABLE' && onExpandGroupsByDefaultChange && (
        <SwitchField
          id="business-layout-expand-default"
          label="Expand groups by default (affected groups always open)"
          checked={expandGroupsByDefault}
          onChange={onExpandGroupsByDefaultChange}
        />
      )}

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
            Their technical services are added to this page automatically and listed under each
            business service in page order. Hide one to keep it out of the business service&apos;s
            status. Services in no business service appear under &ldquo;Other services&rdquo;.
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
                        const onPage = item.memberServiceIds
                          .filter(id => members[id])
                          .sort((a, b) => members[a].position - members[b].position);
                        const shown = onPage.filter(id => members[id].shown).length;
                        return (
                          <SortableRow
                            key={item.id}
                            id={item.id}
                            label={item.name}
                            className={DEPTH_INDENT[depthOf(item.id)]}
                          >
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
                                    {shown} of {item.memberServiceIds.length} shown
                                  </span>
                                  <MoveButtons
                                    name={item.name}
                                    index={index}
                                    count={selected.length}
                                    onMove={delta => move(index, delta)}
                                  />
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
                                    <SwitchField
                                      id={`business-${item.id}-show`}
                                      label="Show on page"
                                      checked={config.showOnPage}
                                      onChange={checked =>
                                        onConfigChange(item.id, { showOnPage: checked })
                                      }
                                    />
                                    {layout === 'BUSINESS_EXPANDABLE' && (
                                      <SwitchField
                                        id={`business-${item.id}-members`}
                                        label="List its services"
                                        checked={config.showMembers}
                                        onChange={checked =>
                                          onConfigChange(item.id, { showMembers: checked })
                                        }
                                      />
                                    )}
                                  </div>
                                )}
                                {onOverride &&
                                  (override ? (
                                    <div className="pl-7">
                                      <OverrideControl
                                        name={item.name}
                                        value={override}
                                        onApply={next => onOverride(item.id, next)}
                                      />
                                    </div>
                                  ) : (
                                    <p className="pl-7 text-xs text-muted-foreground">
                                      Save the page to set a status override for {item.name}.
                                    </p>
                                  ))}
                                <MemberList
                                  group={item.name}
                                  memberIds={onPage}
                                  members={members}
                                  onShownChange={onMemberShownChange}
                                  onReorder={
                                    onMembersReorder
                                      ? ids => onMembersReorder(item.id, ids)
                                      : undefined
                                  }
                                />
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
                <div className="space-y-2">
                  <Input
                    type="search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Find a business service to add"
                    aria-label="Find a business service to add"
                    className="h-8 max-w-xs text-xs"
                  />
                  <div className="flex flex-wrap gap-1.5" aria-label="Add a business service">
                    {matching.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectedIdsChange([...selectedIds, item.id])}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                      >
                        + {item.name}
                      </button>
                    ))}
                    {matching.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No business service matches &ldquo;{query}&rdquo;.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
