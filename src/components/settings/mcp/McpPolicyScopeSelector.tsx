'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import { describeMcpScope } from '@/lib/mcp/auth/scope-labels';

type Props = {
  scopeChoices: string[];
  selectedScopes: string[];
  describeScope?: (scope: string) => string;
};

/**
 * An accessible, high-performance scope selector for MCP Access Policy.
 * Provides granular checkboxes for each scope with:
 * - Global "Select all" / "Uncheck all" controls with counter badge.
 * - Category-level "Select all" / "Uncheck all" controls with indeterminate state support.
 * - Clear visual card states (hover, active, checked border/tint).
 * - Standard HTML form `<input type="checkbox" name="dcrScopes" />` integration for native FormData.
 */
function McpPolicyScopeSelector({
  scopeChoices,
  selectedScopes: initialSelected,
  describeScope = describeMcpScope,
}: Props) {
  const idPrefix = useId();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));

  const readScopes = useMemo(
    () => scopeChoices.filter(scope => scope.endsWith(':read')),
    [scopeChoices]
  );
  const actScopes = useMemo(
    () => scopeChoices.filter(scope => !scope.endsWith(':read')),
    [scopeChoices]
  );

  // Global selection helpers
  const allSelected = scopeChoices.length > 0 && selected.size === scopeChoices.length;
  const noneSelected = selected.size === 0;
  const isGlobalIndeterminate = !allSelected && !noneSelected;

  const globalCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (globalCheckboxRef.current) {
      globalCheckboxRef.current.indeterminate = isGlobalIndeterminate;
    }
  }, [isGlobalIndeterminate]);

  const selectAll = useCallback(() => {
    setSelected(new Set(scopeChoices));
  }, [scopeChoices]);

  const uncheckAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const toggleGlobal = useCallback(() => {
    if (allSelected) {
      uncheckAll();
    } else {
      selectAll();
    }
  }, [allSelected, selectAll, uncheckAll]);

  // Toggle single scope
  const toggleScope = useCallback((scope: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  }, []);

  // Category selection helpers
  const toggleCategory = useCallback((categoryScopes: string[], shouldSelectAll: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const s of categoryScopes) {
        if (shouldSelectAll) {
          next.add(s);
        } else {
          next.delete(s);
        }
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-6">
      {/* Global master bulk action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/20 p-3 sm:px-4">
        <label
          htmlFor={`${idPrefix}-global-select-all`}
          className="flex cursor-pointer items-center gap-2.5 text-xs font-semibold text-foreground select-none"
        >
          <input
            ref={globalCheckboxRef}
            id={`${idPrefix}-global-select-all`}
            type="checkbox"
            checked={allSelected}
            onChange={toggleGlobal}
            className="h-4 w-4 rounded border-border text-primary focus:ring-1 focus:ring-primary accent-primary cursor-pointer"
          />
          <span>Select all scopes</span>
          <Badge
            variant="outline"
            className={cn(
              'ml-1 text-[11px] font-medium tabular-nums',
              allSelected
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : noneSelected
                  ? 'border-border text-muted-foreground'
                  : 'border-primary/40 bg-primary/10 text-primary'
            )}
          >
            {selected.size} of {scopeChoices.length} selected
          </Badge>
        </label>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectAll}
            disabled={allSelected}
            className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Select all
          </Button>
          <span className="text-border" aria-hidden="true">
            •
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={uncheckAll}
            disabled={noneSelected}
            className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Uncheck all
          </Button>
        </div>
      </div>

      {/* Read scopes group */}
      <ScopeGroup
        idPrefix={idPrefix}
        groupKey="read"
        title="Read"
        description="Allow assistants to query inspection and observability data."
        scopes={readScopes}
        selected={selected}
        describeScope={describeScope}
        onToggleScope={toggleScope}
        onToggleCategory={toggleCategory}
        badgeColor="border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-200"
        badgeLabel="READ"
      />

      {/* Propose or run (needs approval) scopes group */}
      {actScopes.length > 0 && (
        <ScopeGroup
          idPrefix={idPrefix}
          groupKey="act"
          title="Propose or run (needs approval)"
          description="Allow assistants to propose mutations and triggers; each request requires explicit human approval."
          scopes={actScopes}
          selected={selected}
          describeScope={describeScope}
          onToggleScope={toggleScope}
          onToggleCategory={toggleCategory}
          badgeColor="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200"
          badgeLabel="ACTION"
        />
      )}
    </div>
  );
}

function ScopeGroup({
  idPrefix,
  groupKey,
  title,
  description,
  scopes,
  selected,
  describeScope,
  onToggleScope,
  onToggleCategory,
  badgeColor,
  badgeLabel,
}: {
  idPrefix: string;
  groupKey: string;
  title: string;
  description: string;
  scopes: string[];
  selected: Set<string>;
  describeScope: (scope: string) => string;
  onToggleScope: (scope: string) => void;
  onToggleCategory: (categoryScopes: string[], shouldSelectAll: boolean) => void;
  badgeColor: string;
  badgeLabel: string;
}) {
  const selectedCount = useMemo(
    () => scopes.filter(s => selected.has(s)).length,
    [scopes, selected]
  );
  const isAllSelected = scopes.length > 0 && selectedCount === scopes.length;
  const isNoneSelected = selectedCount === 0;
  const isIndeterminate = !isAllSelected && !isNoneSelected;

  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleGroupCheckboxChange = () => {
    onToggleCategory(scopes, !isAllSelected);
  };

  return (
    <div className="space-y-3" role="group" aria-label={title}>
      {/* Category header with master checkbox, counter, and Select All / Uncheck All buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-2.5">
        <div className="flex items-center gap-2">
          <label
            htmlFor={`${idPrefix}-${groupKey}-select-all`}
            className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground select-none"
          >
            <input
              ref={checkboxRef}
              id={`${idPrefix}-${groupKey}-select-all`}
              type="checkbox"
              checked={isAllSelected}
              onChange={handleGroupCheckboxChange}
              className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-1 focus:ring-primary accent-primary cursor-pointer"
            />
            <span>{title}</span>
          </label>
          <Badge
            variant="secondary"
            className="h-5 px-1.5 text-[10px] font-semibold tabular-nums leading-none"
          >
            {selectedCount} of {scopes.length} selected
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleCategory(scopes, true)}
            disabled={isAllSelected}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          >
            Select all
          </button>
          <span className="text-muted-foreground/40 text-[10px]" aria-hidden="true">
            /
          </span>
          <button
            type="button"
            onClick={() => onToggleCategory(scopes, false)}
            disabled={isNoneSelected}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          >
            Uncheck all
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{description}</p>

      {/* Scope Cards Grid */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {scopes.map(scope => {
          const isChecked = selected.has(scope);
          const inputId = `${idPrefix}-scope-${scope.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

          return (
            <label
              key={scope}
              htmlFor={inputId}
              className={cn(
                'group relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs transition-all select-none',
                isChecked
                  ? 'border-primary/50 bg-primary/[0.03] shadow-2xs ring-1 ring-primary/20'
                  : 'border-border/70 bg-card/60 hover:border-border hover:bg-muted/30'
              )}
            >
              <input
                id={inputId}
                type="checkbox"
                name="dcrScopes"
                value={scope}
                checked={isChecked}
                onChange={() => onToggleScope(scope)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-1 focus:ring-primary accent-primary cursor-pointer"
              />
              <span className="min-w-0 grow space-y-1">
                <span className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'font-medium transition-colors',
                      isChecked ? 'text-foreground font-semibold' : 'text-foreground/90'
                    )}
                  >
                    {describeScope(scope)}
                  </span>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[9px] font-semibold leading-none uppercase tracking-wide border',
                      badgeColor
                    )}
                  >
                    {badgeLabel}
                  </span>
                </span>
                <span className="block font-mono text-[11px] text-muted-foreground truncate">
                  {scope}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default React.memo(McpPolicyScopeSelector);
