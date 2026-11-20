'use client';

import { Fragment, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Bug, ChevronDown, Info, ScrollText, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { EmptyState, FilterBar, FilterField, toneClasses } from '@/components/patterns';
import { BADGE_BASE_CLASS, badgeSizeClass } from '@/components/patterns/StatusBadge';
import { useTimezone } from '@/contexts/TimezoneContext';
import {
  LogPagination,
  LogTableCard,
  LogTableScroll,
  LogTimestamp,
  MonoId,
  logCellClass,
  logHeadClass,
  logRowClass,
} from '@/components/audit/LogTable';

export type SystemLogRow = {
  key: string;
  level: string;
  message: string;
  timestamp: string;
  component: string | null;
  duration: number | null;
  requestId: string | null;
  userId: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  context: string | null;
};

const LEVELS = {
  error: { label: 'Error', tone: 'critical', icon: XCircle },
  warn: { label: 'Warning', tone: 'elevated', icon: AlertTriangle },
  info: { label: 'Info', tone: 'info', icon: Info },
  debug: { label: 'Debug', tone: null, icon: Bug },
} as const;

function LevelBadge({ level }: { level: string }) {
  const config = LEVELS[level as keyof typeof LEVELS];
  const Icon = config?.icon ?? Info;
  return (
    <span
      className={cn(BADGE_BASE_CLASS, badgeSizeClass('sm'), toneClasses(config?.tone ?? null).soft)}
    >
      <Icon aria-hidden="true" />
      {config?.label ?? level}
    </span>
  );
}

export default function SystemLogsView({
  rows,
  totalCaptured,
  totalMatching,
  page,
  pageSize,
  currentLevel,
  currentSearch,
  currentComponent,
}: {
  rows: SystemLogRow[];
  totalCaptured: number;
  totalMatching: number;
  page: number;
  pageSize: number;
  currentLevel: string;
  currentSearch: string;
  currentComponent: string;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/system-logs';
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const { userTimeZone } = useTimezone();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [componentDraft, setComponentDraft] = useState(currentComponent);

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (!value || value === 'ALL') params.delete(key);
    else params.set(key, value);
    params.delete('page');
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  const hasActiveFilters = Boolean(currentLevel || currentSearch || currentComponent);
  const clearAll = () => {
    setComponentDraft('');
    startTransition(() => router.push(pathname));
  };

  const pageHref = (target: number) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('page', String(target));
    return `${pathname}?${params.toString()}`;
  };
  const totalPages = Math.max(1, Math.ceil(totalMatching / pageSize));

  const toggle = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-4">
      <FilterBar
        search={{
          value: currentSearch,
          onChange: value => updateParam('search', value),
          placeholder: 'Search messages, components or errors…',
          label: 'Search system logs',
          debounceMs: 300,
        }}
        hasActiveFilters={hasActiveFilters}
        onClearAll={clearAll}
        filters={
          <>
            <FilterField label="Level" htmlFor="system-logs-level">
              <Select
                value={currentLevel || 'ALL'}
                onValueChange={value => updateParam('level', value)}
              >
                <SelectTrigger id="system-logs-level" className="h-9 w-[160px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All levels</SelectItem>
                  <SelectItem value="error">Errors</SelectItem>
                  <SelectItem value="warn">Warnings</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="debug">Debug</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Component" htmlFor="system-logs-component">
              <form
                onSubmit={event => {
                  event.preventDefault();
                  updateParam('component', componentDraft.trim());
                }}
              >
                <Input
                  id="system-logs-component"
                  value={componentDraft}
                  onChange={event => setComponentDraft(event.target.value)}
                  onBlur={() => {
                    if (componentDraft.trim() !== currentComponent) {
                      updateParam('component', componentDraft.trim());
                    }
                  }}
                  placeholder="e.g. auth:jwt"
                  className="h-9 w-[160px] text-sm"
                />
              </form>
            </FilterField>
          </>
        }
      />

      <LogTableCard
        footer={
          rows.length > 0 ? (
            <LogPagination
              label="System log pages"
              page={page}
              pageSize={pageSize}
              totalCount={totalMatching}
              prevHref={page > 1 ? pageHref(page - 1) : undefined}
              nextHref={page < totalPages ? pageHref(page + 1) : undefined}
            />
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            variant="simple"
            icon={<ScrollText />}
            title={
              totalCaptured === 0 ? 'No logs captured yet' : 'No log entries match these filters'
            }
            description={
              totalCaptured === 0
                ? 'Entries appear here as the server handles requests and background jobs.'
                : 'Change the level, component or search, or clear the filters to see every entry.'
            }
            action={
              totalCaptured > 0 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/system-logs">Clear filters</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <LogTableScroll label="System log entries">
            <Table className="min-w-[860px]">
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className={cn(logHeadClass, 'w-12')}>
                    <span className="sr-only">Details</span>
                  </TableHead>
                  <TableHead className={cn(logHeadClass, 'w-[180px]')}>Time</TableHead>
                  <TableHead className={cn(logHeadClass, 'w-[120px]')}>Level</TableHead>
                  <TableHead className={cn(logHeadClass, 'w-[180px]')}>Component</TableHead>
                  <TableHead className={logHeadClass}>Message</TableHead>
                  <TableHead className={cn(logHeadClass, 'w-[96px] text-right')}>
                    Duration
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const isOpen = expanded.has(row.key);
                  const hasDetails = Boolean(
                    row.context || row.errorStack || row.requestId || row.userId
                  );
                  const detailsId = `system-log-${row.key.replace(/[^a-zA-Z0-9_-]/g, '')}`;
                  const validDate = !Number.isNaN(new Date(row.timestamp).getTime());
                  return (
                    <Fragment key={row.key}>
                      <TableRow className={cn(logRowClass, isOpen && 'border-b-0 bg-muted/30')}>
                        <TableCell className={cn(logCellClass, 'py-2.5')}>
                          {hasDetails && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              data-icon-button
                              className="h-8 w-8"
                              aria-expanded={isOpen}
                              aria-controls={detailsId}
                              aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${row.message || 'log entry'}`}
                              onClick={() => toggle(row.key)}
                            >
                              <ChevronDown
                                className={cn(
                                  'h-4 w-4 transition-transform duration-200',
                                  isOpen && 'rotate-180'
                                )}
                                aria-hidden="true"
                              />
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className={logCellClass}>
                          {validDate ? (
                            <LogTimestamp date={row.timestamp} timeZone={userTimeZone} />
                          ) : (
                            <span className="text-xs text-muted-foreground">Unknown time</span>
                          )}
                        </TableCell>
                        <TableCell className={logCellClass}>
                          <LevelBadge level={row.level} />
                        </TableCell>
                        <TableCell className={logCellClass}>
                          {row.component ? (
                            <code className="font-mono text-xs text-foreground">
                              {row.component}
                            </code>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className={cn(logCellClass, 'max-w-0')}>
                          <div className="truncate font-medium text-foreground">
                            {row.message || '(no message)'}
                          </div>
                          {row.errorMessage && (
                            <div className="truncate text-xs text-rose-700 dark:text-rose-300">
                              {row.errorMessage}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={cn(logCellClass, 'text-right tabular-nums')}>
                          {row.duration !== null ? (
                            `${row.duration} ms`
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {hasDetails && isOpen && (
                        <TableRow className="border-b border-border bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={6} className="px-4 pb-4 pt-0">
                            <div id={detailsId} className="space-y-3 pl-12 text-xs">
                              {(row.requestId || row.userId) && (
                                <dl className="flex flex-wrap gap-x-6 gap-y-1">
                                  {row.requestId && (
                                    <div className="flex items-center gap-1.5">
                                      <dt className="text-muted-foreground">Request</dt>
                                      <dd>
                                        <MonoId value={row.requestId} label="request ID" />
                                      </dd>
                                    </div>
                                  )}
                                  {row.userId && (
                                    <div className="flex items-center gap-1.5">
                                      <dt className="text-muted-foreground">User</dt>
                                      <dd>
                                        <MonoId value={row.userId} label="user ID" />
                                      </dd>
                                    </div>
                                  )}
                                </dl>
                              )}
                              {row.context && (
                                <div>
                                  <div className="mb-1.5 font-medium text-muted-foreground">
                                    Context
                                  </div>
                                  <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
                                    {row.context}
                                  </pre>
                                </div>
                              )}
                              {row.errorStack && (
                                <div>
                                  <div className="mb-1.5 font-medium text-muted-foreground">
                                    Stack trace
                                  </div>
                                  <pre className="max-h-72 overflow-auto rounded-md border border-rose-200 bg-rose-50 p-3 font-mono text-xs leading-relaxed text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                                    {row.errorStack}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </LogTableScroll>
        )}
      </LogTableCard>
    </div>
  );
}
