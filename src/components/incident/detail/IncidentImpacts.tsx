'use client';
/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (source, status, tier), never request input */

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Boxes, Plus, X } from 'lucide-react';
import type { BusinessServiceTier } from '@prisma/client';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/shadcn/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns/status-tone';
import type { BsStatus } from '@/lib/business-services/contract';
import HealthBadge, {
  BS_STATUS_META,
  CRITICALITY_HINT,
  CRITICALITY_LABEL,
} from '@/components/business-service/HealthBadge';
import {
  searchIncidentDetailBusinessServices,
  setIncidentDetailBusinessImpact,
} from '@/components/incident/detail/actions';

export type IncidentImpactChip = {
  id: string;
  name: string;
  source: 'DIRECT' | 'DEPENDENCY' | 'NESTED' | 'MANUAL';
  excluded: boolean;
  active: boolean;
  criticality?: BusinessServiceTier | null;
  /** Current health; null or missing when it could not be read. */
  status?: BsStatus | null;
};

type PickerOption = {
  id: string;
  name: string;
  criticality?: BusinessServiceTier | null;
  status?: BsStatus | null;
};

/** Health dot: colour plus the label for assistive tech (the visible chip text carries the name). */
function HealthDot({ status }: { status?: BsStatus | null }) {
  if (!status) return null;
  return (
    <span
      aria-hidden
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        toneClasses(BS_STATUS_META[status].tone).solid
      )}
    />
  );
}

const REASON: Record<IncidentImpactChip['source'], string> = {
  DIRECT: 'Its service is affected',
  DEPENDENCY: 'A service it depends on is affected',
  NESTED: 'A business service it relies on is affected',
  MANUAL: 'Marked by a responder',
};

// The page's chip shape (field-styles CHIP_CLASS).
const chip =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground shadow-2xs';

/** "Impacts: Checkout, Payments" with the reason for each; responders can add or remove one. */
export default function IncidentImpacts({
  incidentId,
  impacts,
  linkable = true,
  canEdit = false,
  open: openProp,
  onOpenChange,
  addFromMenu = false,
}: {
  incidentId: string;
  impacts: IncidentImpactChip[];
  linkable?: boolean;
  canEdit?: boolean;
  /** Controlled picker, for when another control (the title card's "+ Add") opens it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** No "+ Impacted business service" chip of its own: "+ Add" opens the picker instead. */
  addFromMenu?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<PickerOption[]>([]);
  const shown = impacts.filter(impact => !impact.excluded);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchIncidentDetailBusinessServices(query)
        .then(rows => {
          if (!cancelled) setOptions(rows);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const change = (businessServiceId: string, impacted: boolean, name?: string) =>
    startTransition(async () => {
      try {
        await setIncidentDetailBusinessImpact(incidentId, businessServiceId, impacted);
        setOpen(false);
        if (!impacted && name)
          notify.success(`${name} is no longer marked as impacted`, {
            // Undo marks it again from now; the removed intervals stay out of its uptime.
            action: { label: 'Undo', onClick: () => change(businessServiceId, true) },
          });
      } catch {
        notify.error('Could not change the impacted business services.');
      }
    });

  if (!shown.length && !canEdit) return null;
  // Nothing marked and the picker is opened from "+ Add": no label, no empty chip, just the picker's anchor.
  if (!shown.length && addFromMenu && !open) return null;
  const marked = new Set(shown.map(impact => impact.id));
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Boxes className="h-3.5 w-3.5" aria-hidden />
        Impacts
      </span>
      <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Affected business services">
        {shown.map(impact => {
          const reason = REASON[impact.source];
          const status = impact.status ? BS_STATUS_META[impact.status].label : null;
          return (
            <li key={impact.id} className="inline-flex items-center gap-0.5">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      chip,
                      'transition-colors hover:border-foreground/30 hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                      // Ended impacts read as history: dashed and muted, with the word, not only the style.
                      !impact.active && 'border-dashed text-muted-foreground shadow-none'
                    )}
                  >
                    <HealthDot status={impact.active ? impact.status : null} />
                    {impact.name}
                    {impact.criticality && (
                      <span className="font-normal text-muted-foreground">
                        {CRITICALITY_LABEL[impact.criticality]}
                      </span>
                    )}
                    {!impact.active && <span className="font-normal">· ended</span>}
                    <span className="sr-only">
                      {status ? `, ${status}` : ''}: {reason}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 space-y-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{impact.name}</span>
                    {impact.status && <HealthBadge status={impact.status} />}
                  </div>
                  {impact.criticality && (
                    <p className="text-xs text-muted-foreground">
                      {CRITICALITY_LABEL[impact.criticality]} ·{' '}
                      {CRITICALITY_HINT[impact.criticality]}
                    </p>
                  )}
                  <p>
                    {reason}
                    {impact.active ? '.' : '. The impact has ended.'}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {linkable && (
                      <Link
                        href={`/services/business/${impact.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Open business service
                        <ArrowUpRight className="h-3 w-3" aria-hidden />
                      </Link>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              {canEdit && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => change(impact.id, false, impact.name)}
                  aria-label={`Not impacting ${impact.name}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          {addFromMenu ? (
            <PopoverAnchor className="h-8 w-px" />
          ) : (
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={pending}
                className={`${chip} border-dashed text-muted-foreground hover:text-foreground disabled:opacity-50`}
              >
                <Plus className="h-3 w-3" aria-hidden />
                Impacted business service
              </button>
            </PopoverTrigger>
          )}
          <PopoverContent className="w-72 p-0" align="start">
            <Command shouldFilter={false} className="rounded-lg">
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search business services..."
                className="h-8 border-none text-xs focus:ring-0"
              />
              <CommandList className="max-h-48">
                <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                  No business services found.
                </CommandEmpty>
                <CommandGroup className="p-1">
                  {options
                    .filter(option => !marked.has(option.id))
                    .map(option => (
                      <CommandItem
                        key={option.id}
                        value={option.id}
                        onSelect={() => change(option.id, true)}
                        className="cursor-pointer gap-2 rounded-md py-1.5 text-xs"
                      >
                        <HealthDot status={option.status} />
                        <span className="min-w-0 flex-1 truncate">{option.name}</span>
                        {option.status && option.status !== 'OPERATIONAL' && (
                          <span className="shrink-0 text-muted-foreground">
                            {BS_STATUS_META[option.status].label}
                          </span>
                        )}
                        {option.criticality && (
                          <span className="shrink-0 text-muted-foreground">
                            {CRITICALITY_LABEL[option.criticality]}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
