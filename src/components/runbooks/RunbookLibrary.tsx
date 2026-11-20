'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Hash, Layers, PlayCircle, Plus, Server } from 'lucide-react';
import { createRunbookAction } from '@/app/(app)/runbooks/actions';
import EmptyState from '@/components/ui/EmptyState';
import {
  DirectoryCardGrid,
  DirectoryGuide,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  RelativeTime,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
} from '@/components/patterns';
import { RunbookStatusBadge } from './RunbookStatusBadge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { SubmitButton, FormSelect } from './RunbookControls';
import { RunbookCard, runbookLifecycle, type RunbookCardData } from './library/RunbookCard';
import { formatDateTime } from '@/lib/timezone';
import {
  RUNBOOK_TAG_MAX_COUNT,
  isValidRunbookTag,
  parseTagList,
} from '@/lib/runbooks/metadata-form';
import { cn } from '@/lib/utils';

export type RunbookTeamOption = { id: string; name: string };

const NO_TEAM = 'none';

function tagsValidationMessage(tags: string[]): string {
  const invalid = tags.filter(tag => !isValidRunbookTag(tag));
  if (invalid.length)
    return `Invalid tag: ${invalid[0]}. Use lowercase letters, numbers, dot, dash or underscore (max 40 characters).`;
  if (tags.length > RUNBOOK_TAG_MAX_COUNT) return `Use at most ${RUNBOOK_TAG_MAX_COUNT} tags.`;
  return '';
}

export function CreateRunbookDialog({ teams = [] }: { teams?: RunbookTeamOption[] }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [customSlug, setCustomSlug] = useState(false);
  const [ownerTeamId, setOwnerTeamId] = useState(NO_TEAM);
  const [tagsInput, setTagsInput] = useState('');
  const tags = parseTagList(tagsInput);
  const tagsError = tagsValidationMessage(tags);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="gap-1.5 bg-white text-zinc-950 hover:bg-zinc-100 font-semibold shadow-xs">
          <Plus className="h-4 w-4" />
          <span>New Runbook</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Runbook</DialogTitle>
          <DialogDescription>
            Start with a template, configure your targets, then publish an immutable version.
          </DialogDescription>
        </DialogHeader>
        <form action={createRunbookAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-runbook-name">Name</Label>
            <Input
              id="new-runbook-name"
              name="name"
              value={name}
              onChange={event => {
                setName(event.target.value);
                if (!customSlug)
                  setSlug(
                    event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '')
                      .slice(0, 120)
                  );
              }}
              required
              maxLength={200}
              placeholder="Linux service recovery"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-runbook-description">Description</Label>
            <Textarea
              id="new-runbook-description"
              name="description"
              maxLength={5000}
              placeholder="When should responders use this workflow?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-runbook-slug">Slug</Label>
            <Input
              id="new-runbook-slug"
              name="slug"
              value={slug}
              onChange={event => {
                setCustomSlug(true);
                setSlug(event.target.value);
              }}
              required
              maxLength={120}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-runbook-owner-team">
                Owner team <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <input
                type="hidden"
                name="ownerTeamId"
                value={ownerTeamId === NO_TEAM ? '' : ownerTeamId}
              />
              <Select value={ownerTeamId} onValueChange={setOwnerTeamId}>
                <SelectTrigger id="new-runbook-owner-team" aria-label="Owner team">
                  <SelectValue placeholder="No owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEAM}>No owner</SelectItem>
                  {teams.map(team => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-runbook-tags">
                Tags <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="new-runbook-tags"
                name="tags"
                value={tagsInput}
                onChange={event => setTagsInput(event.target.value)}
                ref={element => element?.setCustomValidity(tagsError)}
                aria-invalid={tagsError ? true : undefined}
                aria-describedby="new-runbook-tags-hint"
                placeholder="linux, database, p1"
                autoComplete="off"
              />
            </div>
          </div>
          <div id="new-runbook-tags-hint" className="-mt-2 space-y-1.5">
            {tags.length > 0 ? (
              <ul className="flex flex-wrap gap-1" aria-label="Tag preview">
                {tags.map(tag => (
                  <li
                    key={tag}
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 font-mono text-[11px]',
                      isValidRunbookTag(tag)
                        ? 'border-border/70 bg-muted/40 text-muted-foreground'
                        : 'border-destructive/50 bg-destructive/10 text-destructive'
                    )}
                  >
                    <Hash className="h-2.5 w-2.5" aria-hidden="true" />
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className={cn('text-xs', tagsError ? 'text-destructive' : 'text-muted-foreground')}>
              {tagsError || 'Separate tags with commas. Tags help responders find runbooks fast.'}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Template</Label>
            <FormSelect
              name="template"
              label="Runbook template"
              defaultValue="empty"
              options={[
                { value: 'empty', label: 'Empty workflow' },
                { value: 'diagnostics', label: 'Linux diagnostics' },
                { value: 'service-recovery', label: 'Service recovery · approval before restart' },
                {
                  value: 'kubernetes-recovery',
                  label: 'Kubernetes recovery · approval before restart',
                },
              ]}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Templates are starting points. Review service names, namespaces and Agent policy before
            publishing.
          </p>
          <SubmitButton pendingLabel="Creating…" className="w-full">
            Create Runbook
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
const GUIDE_STEPS = [
  {
    title: 'Author a draft',
    description:
      'Create a runbook from a template, then edit its steps, inputs and targets as a draft version.',
  },
  {
    title: 'Publish after safety verification',
    description:
      'Publishing validates the definition and its checksum, then freezes it as an immutable version. Approval steps still gate risky actions at run time.',
  },
  {
    title: 'Bind to services or automations',
    description:
      'Bind a published runbook to services as a suggestion, or as an automatic action pinned to one version.',
  },
  {
    title: 'Run from an incident',
    description:
      'Responders run suggested or any published runbook from the incident, and follow progress in Executions.',
  },
] as const;

const GUIDE_LINKS = [
  {
    label: 'Executions',
    href: '/runbooks/executions',
    icon: <PlayCircle className="h-3.5 w-3.5" />,
  },
  { label: 'Fleet agents', href: '/runbooks/agents', icon: <Server className="h-3.5 w-3.5" /> },
  { label: 'Services', href: '/services', icon: <Layers className="h-3.5 w-3.5" /> },
] as const;

const MAX_TABLE_TAGS = 2;

function TagLinks({ tags, max }: { tags: string[]; max: number }) {
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="Tags">
      {tags.slice(0, max).map(tag => (
        <li key={tag}>
          <Link
            href={`/runbooks?tag=${encodeURIComponent(tag)}`}
            aria-label={`Filter by tag ${tag}`}
            className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            #{tag}
          </Link>
        </li>
      ))}
      {tags.length > max && (
        <li className="text-[11px] font-medium text-muted-foreground">+{tags.length - max}</li>
      )}
    </ul>
  );
}

function Lifecycle({ runbook }: { runbook: RunbookCardData }) {
  const lifecycle = runbookLifecycle(runbook);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <RunbookStatusBadge status={lifecycle} size="sm" context="lifecycle" />
      {lifecycle === 'PUBLISHED' && (
        <span className="font-mono text-[11px] text-muted-foreground">
          v{runbook.publishedVersion}
          {runbook.draftVersion ? ` · draft v${runbook.draftVersion}` : ''}
        </span>
      )}
    </span>
  );
}

function Bindings({ runbook }: { runbook: RunbookCardData }) {
  const services = runbook.sampleServices ?? [];
  if (runbook.archivedAt) return <span className="text-muted-foreground">Bindings disabled</span>;
  if (runbook.bindings === 0) return <span className="text-muted-foreground">None</span>;
  const label = plural(runbook.bindings, 'service binding');
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={services.join(', ') || undefined}>
      <span className="sr-only">{label}: </span>
      {services[0] ? (
        <>
          <span className="truncate">{services[0]}</span>
          {runbook.bindings > 1 && (
            <span className="shrink-0 text-xs text-muted-foreground">+{runbook.bindings - 1}</span>
          )}
        </>
      ) : (
        <span aria-hidden="true">{label}</span>
      )}
    </span>
  );
}

function LastActivity({ runbook, timeZone }: { runbook: RunbookCardData; timeZone: string }) {
  const last = runbook.lastExecution;
  return (
    <span className="flex min-w-0 flex-col">
      {last ? (
        <span className="flex items-center gap-1.5">
          <span className="sr-only">Last run:</span>
          <RunbookStatusBadge status={last.status} size="sm" context="execution" />
          <RelativeTime date={last.createdAt} timeZone={timeZone} />
        </span>
      ) : (
        <span className="text-muted-foreground">Never run</span>
      )}
      <span className="text-xs text-muted-foreground">
        {plural(runbook.executions, 'run')} · updated{' '}
        <RelativeTime date={runbook.updatedAt} timeZone={timeZone} />
      </span>
    </span>
  );
}

function plural(count: number, word: string) {
  return `${new Intl.NumberFormat('en-US').format(count)} ${word}${count === 1 ? '' : 's'}`;
}

export default function RunbookLibrary({
  runbooks,
  canManage,
  userTimeZone,
  total,
  page = 1,
  pageSize = runbooks.length || 1,
  teams = [],
  hasActiveFilters = false,
  footer,
}: {
  runbooks: Array<RunbookCardData>;
  canManage: boolean;
  userTimeZone: string;
  total?: number;
  page?: number;
  pageSize?: number;
  teams?: RunbookTeamOption[];
  hasActiveFilters?: boolean;
  /** Pagination, rendered inside the directory card. */
  footer?: ReactNode;
}) {
  const [view, setView] = useDirectoryView('runbooks');
  const shownTotal = total ?? runbooks.length;
  const from = runbooks.length ? (page - 1) * pageSize + 1 : 0;
  const to = runbooks.length ? from + runbooks.length - 1 : 0;

  const columns: DirectoryColumn<RunbookCardData>[] = [
    {
      id: 'runbook',
      header: 'Runbook',
      className: 'max-w-[22rem]',
      cell: r => (
        <DirectoryPrimaryCell
          href={`/runbooks/${r.id}`}
          title={r.name}
          subtitle={r.description || 'No description yet.'}
        />
      ),
    },
    { id: 'lifecycle', header: 'Lifecycle', hideable: true, cell: r => <Lifecycle runbook={r} /> },
    {
      id: 'bindings',
      hideable: true,
      header: 'Service bindings',
      className: 'hidden md:table-cell max-w-[14rem]',
      cell: r => <Bindings runbook={r} />,
    },
    {
      id: 'team',
      hideable: true,
      header: 'Owning team',
      className: 'hidden lg:table-cell',
      cell: r =>
        r.ownerTeam ? (
          <span>{r.ownerTeam.name}</span>
        ) : (
          <span className="text-muted-foreground">No owner</span>
        ),
    },
    {
      id: 'tags',
      hideable: true,
      header: 'Tags',
      className: 'hidden xl:table-cell',
      cell: r => <TagLinks tags={r.tags ?? []} max={MAX_TABLE_TAGS} />,
    },
    {
      id: 'activity',
      hideable: true,
      header: 'Last run / updated',
      className: 'hidden md:table-cell',
      cell: r => <LastActivity runbook={r} timeZone={userTimeZone} />,
    },
  ];

  const columnVisibility = useDirectoryColumns('runbooks', columns);
  const mobileRow = (r: RunbookCardData) => (
    <div className="min-w-0 space-y-1">
      <Link
        href={`/runbooks/${r.id}`}
        className="block truncate font-medium text-foreground hover:underline"
      >
        {r.name}
      </Link>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Lifecycle runbook={r} />
        <span>{r.ownerTeam?.name ?? 'No owner'}</span>
        <span>{plural(r.bindings, 'binding')}</span>
      </div>
      {(r.tags?.length ?? 0) > 0 && <TagLinks tags={r.tags ?? []} max={MAX_TABLE_TAGS} />}
      <LastActivity runbook={r} timeZone={userTimeZone} />
    </div>
  );

  const rowActions = (r: RunbookCardData) => (
    <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs">
      <Link href={`/runbooks/${r.id}`} aria-label={`Open ${r.name}`}>
        Open
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </Button>
  );

  const empty = (
    <EmptyState
      icon={<BookOpen />}
      title={hasActiveFilters ? 'No matching runbooks' : 'No runbooks yet'}
      description={
        hasActiveFilters
          ? 'Try a different search, team, tag or status filter.'
          : 'Create a reusable diagnostics or recovery workflow so responders can act in seconds.'
      }
      action={
        hasActiveFilters ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/runbooks">Clear all filters</Link>
          </Button>
        ) : canManage ? (
          <CreateRunbookDialog teams={teams} />
        ) : undefined
      }
    />
  );

  return (
    <section
      aria-label="Runbook library"
      className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <DirectoryHeader
        title="Runbook library"
        summary={
          <span aria-live="polite">
            Showing {from}–{to} of {shownTotal}
          </span>
        }
        guide={<DirectoryGuide title="How runbooks work" steps={GUIDE_STEPS} links={GUIDE_LINKS} />}
        columns={columnVisibility}
        density
        view={runbooks.length > 0 ? { value: view, onChange: setView } : undefined}
      />
      {runbooks.length === 0 ? (
        empty
      ) : view === 'table' ? (
        <DirectoryTable
          rows={runbooks}
          getRowId={r => r.id}
          columns={columns}
          hiddenColumns={columnVisibility.hidden}
          label="Runbooks"
          rowActions={rowActions}
          mobileRow={mobileRow}
        />
      ) : (
        <DirectoryCardGrid>
          {runbooks.map(item => (
            <RunbookCard
              key={item.id}
              runbook={item}
              userTimeZone={userTimeZone}
              updatedLabel={formatDateTime(item.updatedAt, userTimeZone, { format: 'date' })}
            />
          ))}
        </DirectoryCardGrid>
      )}
      {footer && <div className="px-4 pb-3">{footer}</div>}
    </section>
  );
}
