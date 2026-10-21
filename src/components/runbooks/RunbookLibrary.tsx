'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { BookOpen, Hash, LayoutGrid, Plus, Rows3 } from 'lucide-react';
import { createRunbookAction } from '@/app/(app)/runbooks/actions';
import EmptyState from '@/components/ui/EmptyState';
import { Segmented } from './ui/primitives';
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
import { RunbookCard, type RunbookCardData } from './library/RunbookCard';
import { formatDateTime } from '@/lib/timezone';
import {
  RUNBOOK_TAG_MAX_COUNT,
  isValidRunbookTag,
  parseTagList,
} from '@/lib/runbooks/metadata-form';
import { cn } from '@/lib/utils';

export type RunbookTeamOption = { id: string; name: string };

const NO_TEAM = 'none';

type Density = 'grid' | 'list';
const DENSITY_STORAGE_KEY = 'opsknight:runbook-library-density';
const DENSITY_EVENT = 'opsknight:runbook-library-density-change';

function subscribeDensity(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(DENSITY_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(DENSITY_EVENT, onChange);
  };
}

function readDensity(): Density {
  try {
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function writeDensity(next: Density) {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
  } catch {
    // Private browsing can block storage; the default layout remains.
  }
  window.dispatchEvent(new Event(DENSITY_EVENT));
}

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

export default function RunbookLibrary({
  runbooks,
  canManage,
  userTimeZone,
  total,
  teams = [],
  hasActiveFilters = false,
}: {
  runbooks: Array<RunbookCardData>;
  canManage: boolean;
  userTimeZone: string;
  total?: number;
  teams?: RunbookTeamOption[];
  hasActiveFilters?: boolean;
}) {
  const filtered = runbooks;
  const density = useSyncExternalStore(subscribeDensity, readDensity, () => 'grid' as Density);
  const countDisplay =
    total !== undefined && total !== filtered.length
      ? `${filtered.length} of ${total} runbooks`
      : `${filtered.length} ${filtered.length === 1 ? 'runbook' : 'runbooks'}`;

  return (
    <section aria-label="Runbook library" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs font-medium tabular-nums text-muted-foreground">
          {countDisplay}
        </p>
        {filtered.length > 0 && (
          <Segmented
            label="Library layout"
            value={density}
            onChange={writeDensity}
            className="hidden sm:inline-flex"
            options={[
              {
                value: 'grid',
                label: (
                  <>
                    <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                    Grid
                  </>
                ),
              },
              {
                value: 'list',
                label: (
                  <>
                    <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />
                    List
                  </>
                ),
              },
            ]}
          />
        )}
      </div>

      <div
        className={cn(
          density === 'list' ? 'flex flex-col gap-2' : 'grid gap-4 md:grid-cols-2 2xl:grid-cols-3'
        )}
      >
        {filtered.map(item => (
          <RunbookCard
            key={item.id}
            runbook={item}
            userTimeZone={userTimeZone}
            canManage={canManage}
            density={density}
            updatedLabel={formatDateTime(item.updatedAt, userTimeZone, { format: 'date' })}
          />
        ))}
      </div>

      {filtered.length === 0 && (
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
      )}
    </section>
  );
}
