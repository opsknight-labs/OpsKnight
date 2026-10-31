'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import { describeMcpScope } from '@/lib/mcp/auth/scope-labels';

type Props = {
  scopeChoices: string[];
  defaultScopes: string[];
  describeScope?: (scope: string) => string;
};

/**
 * An accessible scope selector for registering custom MCP clients.
 * Provides granular checkboxes with:
 * - Master "Select all" / "Uncheck all" controls with indeterminate state.
 * - Live selection counter badge.
 * - Standard HTML form `<input type="checkbox" name="scopes" />` for native FormData.
 */
function McpClientScopeSelector({
  scopeChoices,
  defaultScopes,
  describeScope = describeMcpScope,
}: Props) {
  const idPrefix = useId();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultScopes));

  const allSelected = scopeChoices.length > 0 && selected.size === scopeChoices.length;
  const noneSelected = selected.size === 0;
  const isIndeterminate = !allSelected && !noneSelected;

  const masterCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const selectAll = useCallback(() => {
    setSelected(new Set(scopeChoices));
  }, [scopeChoices]);

  const uncheckAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      uncheckAll();
    } else {
      selectAll();
    }
  }, [allSelected, selectAll, uncheckAll]);

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

  return (
    <fieldset className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor={`${idPrefix}-client-scopes-all`}
            className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground select-none"
          >
            <input
              ref={masterCheckboxRef}
              id={`${idPrefix}-client-scopes-all`}
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-1 focus:ring-primary accent-primary cursor-pointer"
            />
            <span>Allowed scopes</span>
          </label>
          <Badge
            variant="secondary"
            className="h-5 px-1.5 text-[10px] font-semibold tabular-nums leading-none"
          >
            {selected.size} of {scopeChoices.length} selected
          </Badge>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectAll}
            disabled={allSelected}
            className="h-6 px-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            Select all
          </Button>
          <span className="text-border text-xs" aria-hidden="true">
            •
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={uncheckAll}
            disabled={noneSelected}
            className="h-6 px-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            Uncheck all
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {scopeChoices.map(scope => {
          const isChecked = selected.has(scope);
          const isRead = scope.endsWith(':read');
          const inputId = `${idPrefix}-client-scope-${scope.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

          return (
            <label
              key={scope}
              htmlFor={inputId}
              className={cn(
                'group relative flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-xs transition-all select-none',
                isChecked
                  ? 'border-primary/50 bg-primary/[0.03] ring-1 ring-primary/20'
                  : 'border-border/70 bg-card/60 hover:border-border hover:bg-muted/30'
              )}
            >
              <input
                id={inputId}
                type="checkbox"
                name="scopes"
                value={scope}
                checked={isChecked}
                onChange={() => toggleScope(scope)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-primary focus:ring-1 focus:ring-primary accent-primary cursor-pointer"
              />
              <span className="min-w-0 grow space-y-0.5">
                <span className="flex items-center justify-between gap-1.5">
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
                      isRead
                        ? 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-200'
                        : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200'
                    )}
                  >
                    {isRead ? 'READ' : 'ACTION'}
                  </span>
                </span>
                <span className="block font-mono text-[10px] text-muted-foreground truncate">
                  {scope}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default React.memo(McpClientScopeSelector);
