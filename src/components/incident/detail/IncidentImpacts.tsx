'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Boxes, Plus, X } from 'lucide-react';
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
};

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
  const [options, setOptions] = useState<Array<{ id: string; name: string }>>([]);
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

  const change = (businessServiceId: string, impacted: boolean) =>
    startTransition(async () => {
      try {
        await setIncidentDetailBusinessImpact(incidentId, businessServiceId, impacted);
        setOpen(false);
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
          const reason = REASON[impact.source] + (impact.active ? '' : ' (ended)');
          return (
            <li key={impact.id} className="inline-flex items-center gap-0.5">
              {linkable ? (
                <Link
                  href={`/services/business/${impact.id}`}
                  title={reason}
                  className={`${chip} transition-colors hover:border-foreground/30 hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring`}
                >
                  {impact.name}
                  <span className="sr-only">: {reason}</span>
                </Link>
              ) : (
                <span className={chip} title={reason}>
                  {impact.name}
                  <span className="sr-only">: {reason}</span>
                </span>
              )}
              {canEdit && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => change(impact.id, false)}
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
                        className="cursor-pointer rounded-md py-1.5 text-xs"
                      >
                        {option.name}
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
