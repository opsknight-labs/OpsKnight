'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Search, Shield, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';

/**
 * A compact "3 scopes" chip that opens an accessible, search-filtered, and scrollable
 * popover dropdown. Designed for clear visibility of granular permissions.
 */
export default function McpScopeSummary({
  scopes,
  context,
}: {
  /** Each scope with its plain-language label, computed on the server. */
  scopes: { scope: string; label: string }[];
  /** Names what the scopes belong to, for the accessible name, e.g. "Claude for Jane Doe". */
  context: string;
}) {
  const [search, setSearch] = useState('');

  const filteredScopes = useMemo(() => {
    if (!search.trim()) return scopes;
    const q = search.toLowerCase();
    return scopes.filter(
      s => s.scope.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
    );
  }, [scopes, search]);

  if (scopes.length === 0) {
    return <span className="text-xs text-muted-foreground">No scopes</span>;
  }

  const noun = scopes.length === 1 ? 'scope' : 'scopes';
  const hasActions = scopes.some(s => !s.scope.endsWith(':read'));

  return (
    <Popover onOpenChange={open => !open && setSearch('')}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-icon-button
          aria-label={`${scopes.length} ${noun} for ${context}. Show list`}
          className={cn(
            'group inline-flex h-6.5 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[11px] font-semibold transition-all duration-150',
            'border-border/80 bg-background/80 hover:border-primary/50 hover:bg-primary/5 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            hasActions ? 'text-foreground' : 'text-foreground/90'
          )}
        >
          <Shield
            className={cn(
              'h-3 w-3 shrink-0 transition-colors',
              hasActions ? 'text-amber-500' : 'text-blue-500'
            )}
            aria-hidden="true"
          />
          <span>
            {scopes.length} {noun}
          </span>
          <ChevronDown
            className="h-3 w-3 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="w-84 max-w-[calc(100vw-2rem)] rounded-xl border border-border/80 bg-popover/95 p-3.5 shadow-xl backdrop-blur-md"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 border-b border-border/70">
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Allowed Scopes
            </span>
          </div>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold tabular-nums">
            {scopes.length} {noun}
          </Badge>
        </div>

        {/* Live Filter Search (shown when > 3 scopes) */}
        {scopes.length > 3 && (
          <div className="relative mt-2.5 mb-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="text"
              placeholder="Search scopes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 pl-8 pr-7 text-xs bg-muted/40 border-border/60 focus-visible:ring-1"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Scrollable list with max height and custom scroll */}
        <div className="mt-2 max-h-56 overflow-y-auto overscroll-contain pr-1 space-y-1.5 scrollbar-thin">
          {filteredScopes.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No scopes match &ldquo;{search}&rdquo;
            </p>
          ) : (
            <ul className="space-y-1.5">
              {filteredScopes.map(({ scope, label }) => {
                const isRead = scope.endsWith(':read');
                return (
                  <li
                    key={scope}
                    className="group flex items-start justify-between gap-2 rounded-lg border border-border/40 bg-muted/20 p-2 transition-colors hover:border-border hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground leading-snug">{label}</p>
                      <code className="block mt-0.5 font-mono text-[10px] text-muted-foreground truncate">
                        {scope}
                      </code>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                        isRead
                          ? 'border border-blue-200/60 bg-blue-50/60 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300'
                          : 'border border-amber-200/60 bg-amber-50/60 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300'
                      )}
                    >
                      {isRead ? 'Read' : 'Action'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-2.5 pt-2 border-t border-border/60 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="truncate" title={context}>
            Target: <strong className="text-foreground">{context}</strong>
          </span>
          <span>Role-gated</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
