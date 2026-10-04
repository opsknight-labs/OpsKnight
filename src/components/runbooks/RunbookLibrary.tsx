'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Plus, Search } from 'lucide-react';
import { createRunbookAction } from '@/app/(app)/runbooks/actions';
import EmptyState from '@/components/ui/EmptyState';
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
import { SubmitButton, FormSelect, StatusBadge } from './RunbookControls';

export function CreateRunbookDialog() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [customSlug, setCustomSlug] = useState(false);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          New Runbook
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
}: {
  runbooks: Array<{
    id: string;
    name: string;
    description: string;
    publishedVersion: number | null;
    draftVersion: number | null;
    bindings: number;
    executions: number;
    updatedAt: string;
  }>;
  canManage: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const filtered = runbooks.filter(
    item =>
      `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'published' ? item.publishedVersion !== null : item.draftVersion !== null))
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search runbooks"
            placeholder="Search runbooks…"
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="sm:w-44">
          <FormSelect
            name="filter"
            label="Filter runbooks"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: 'all', label: 'All runbooks' },
              { value: 'published', label: 'Published' },
              { value: 'draft', label: 'Drafts' },
            ]}
          />
        </div>
      </div>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {filtered.length} runbooks
      </p>
      {filtered.map(item => (
        <Link
          key={item.id}
          href={`/runbooks/${item.id}`}
          className="group flex flex-col justify-between gap-4 rounded-xl border bg-card p-5 shadow-2xs transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-row sm:items-center"
        >
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-base font-semibold">{item.name}</h2>
              <StatusBadge status={item.publishedVersion !== null ? 'PUBLISHED' : 'DRAFT'} />
              {item.publishedVersion !== null && (
                <span className="text-xs text-muted-foreground">v{item.publishedVersion}</span>
              )}
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {item.description || 'No description yet.'}
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>{item.bindings} services</span>
              <span>{item.executions} executions</span>
              <span>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
              {item.draftVersion && <span>Draft v{item.draftVersion}</span>}
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </Link>
      ))}
      {filtered.length === 0 && (
        <EmptyState
          icon={<BookOpen />}
          title={runbooks.length ? 'No matching runbooks' : 'No runbooks yet'}
          description="Create reusable diagnostics and remediation workflows."
          action={canManage ? <CreateRunbookDialog /> : undefined}
        />
      )}
    </section>
  );
}
