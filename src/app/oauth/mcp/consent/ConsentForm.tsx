'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Info, PencilLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { McpConsentGroup, McpConsentScope } from '@/lib/mcp/auth/consent-offer';

type Props = {
  /** The server action that records the decision. */
  action: (form: FormData) => Promise<void>;
  requestId: string;
  clientName: string;
  groups: McpConsentGroup[];
  /** Shown once, muted, when some requested permissions are not available to this role. */
  unavailableNote: string | null;
  wide: boolean;
};

const checkboxClass =
  'mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:border-slate-600 dark:accent-slate-100 dark:focus-visible:ring-white dark:focus-visible:ring-offset-slate-900';

export default function ConsentForm({
  action,
  requestId,
  clientName,
  groups,
  unavailableNote,
  wide,
}: Props) {
  const all = useMemo(() => groups.flatMap(group => [...group.view, ...group.change]), [groups]);
  const [selected, setSelected] = useState(
    () => new Set(all.filter(item => item.checked).map(item => item.scope))
  );
  const summaryId = useId();
  const hintId = useId();
  const total = all.length;
  const count = selected.size;

  const toggle = (scopes: string[], on: boolean) =>
    setSelected(previous => {
      const next = new Set(previous);
      for (const scope of scopes) {
        if (on) next.add(scope);
        else next.delete(scope);
      }
      return next;
    });

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={requestId} />
      {total > 0 ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Choose what {clientName} can do
            </h2>
            <p
              id={summaryId}
              aria-live="polite"
              className="text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400"
            >
              {count} of {total} selected
            </p>
          </div>
          <div className={cn('grid gap-3', wide && 'lg:grid-cols-2 lg:gap-4')}>
            {groups.map(group => (
              <ScopeGroup key={group.id} group={group} selected={selected} onToggle={toggle} />
            ))}
          </div>
        </>
      ) : (
        <p
          id={summaryId}
          className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
        >
          Your role can’t use any of the permissions this assistant asked for. Cancel and ask an
          administrator if you need access.
        </p>
      )}
      {unavailableNote && (
        <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{unavailableNote}</span>
        </p>
      )}
      {/* On phones a long list keeps the decision in reach. */}
      <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none dark:border-slate-800 dark:bg-slate-900/95 sm:dark:bg-transparent">
        <button
          name="decision"
          value="deny"
          type="submit"
          formNoValidate
          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus-visible:ring-white"
        >
          Cancel
        </button>
        {total > 0 && (
          <button
            name="decision"
            value="allow"
            type="submit"
            disabled={count === 0}
            aria-describedby={count === 0 ? hintId : undefined}
            className="inline-flex items-center justify-center rounded-xl bg-slate-950 font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 dark:focus-visible:ring-white"
          >
            Allow
          </button>
        )}
      </div>
      {total > 0 && count === 0 && (
        <p id={hintId} className="text-right text-xs text-slate-500 dark:text-slate-400">
          Select at least one permission to allow this connection.
        </p>
      )}
    </form>
  );
}

function ScopeGroup({
  group,
  selected,
  onToggle,
}: {
  group: McpConsentGroup;
  selected: Set<string>;
  onToggle: (scopes: string[], on: boolean) => void;
}) {
  const scopes = [...group.view, ...group.change].map(item => item.scope);
  const chosen = scopes.filter(scope => selected.has(scope)).length;
  const allRef = useRef<HTMLInputElement>(null);
  const allId = useId();
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = chosen > 0 && chosen < scopes.length;
  }, [chosen, scopes.length]);

  return (
    <fieldset className="relative min-w-0 rounded-xl border border-slate-200 bg-white px-4 pb-3 pt-3 dark:border-slate-700 dark:bg-slate-900/40">
      <legend className="float-left w-full pr-28 font-['Space_Grotesk',sans-serif] text-sm font-semibold text-slate-900 dark:text-slate-100">
        {group.label}
      </legend>
      {scopes.length > 1 && (
        <label
          htmlFor={allId}
          className="absolute right-3 top-2.5 flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        >
          <input
            ref={allRef}
            id={allId}
            type="checkbox"
            className={cn(checkboxClass, 'mt-0')}
            checked={chosen === scopes.length}
            onChange={event => onToggle(scopes, event.target.checked)}
          />
          Select all<span className="sr-only"> {group.label} permissions</span>
        </label>
      )}
      <div className="clear-both space-y-3 pt-2">
        {group.view.length > 0 && (
          <ScopeList title="View" items={group.view} selected={selected} onToggle={onToggle} />
        )}
        {group.change.length > 0 && (
          <ScopeList
            title="Change"
            items={group.change}
            selected={selected}
            onToggle={onToggle}
            changes
          />
        )}
      </div>
    </fieldset>
  );
}

function ScopeList({
  title,
  items,
  selected,
  onToggle,
  changes = false,
}: {
  title: string;
  items: McpConsentScope[];
  selected: Set<string>;
  onToggle: (scopes: string[], on: boolean) => void;
  changes?: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {title}
      </legend>
      <ul className="space-y-0.5 px-0">
        {items.map(item => {
          const id = `scope-${item.scope.replace(/[^a-z0-9-]/g, '-')}`;
          const on = selected.has(item.scope);
          return (
            <li key={item.scope} className="px-0">
              <label
                htmlFor={id}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-slate-50 sm:min-h-0 dark:hover:bg-slate-800/60',
                  changes && on && 'bg-amber-50/60 dark:bg-amber-950/20'
                )}
              >
                <input
                  id={id}
                  type="checkbox"
                  name="scope"
                  value={item.scope}
                  checked={on}
                  onChange={event => onToggle([item.scope], event.target.checked)}
                  className={checkboxClass}
                />
                <span className="min-w-0 flex-1 text-slate-800 dark:text-slate-100">
                  {item.label}
                  {/* Mark exactly the selected permissions that let the assistant change things. */}
                  {changes && on && (
                    <span className="ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px align-middle text-[11px] font-medium text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
                      <PencilLine className="h-3 w-3" aria-hidden="true" />
                      Can make changes
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
