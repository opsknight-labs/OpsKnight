'use client';

import { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
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
import { SubmitButton, FormSelect } from './RunbookControls';
import { RunbookCard, type RunbookCardData } from './library/RunbookCard';
import { formatDateTime } from '@/lib/timezone';

export function CreateRunbookDialog() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [customSlug, setCustomSlug] = useState(false);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="gap-1.5 shadow-xs font-semibold">
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
}: {
  runbooks: Array<RunbookCardData>;
  canManage: boolean;
  userTimeZone: string;
}) {
  const filtered = runbooks;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p aria-live="polite" className="text-xs text-muted-foreground font-medium">
          {filtered.length} {filtered.length === 1 ? 'runbook' : 'runbooks'}
        </p>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-1">
        {filtered.map(item => {
          const _updatedAtFormatted = formatDateTime(item.updatedAt, userTimeZone, { format: 'date' });
          return (
            <RunbookCard
              key={item.id}
              runbook={item}
              userTimeZone={userTimeZone}
              canManage={canManage}
            />
          );
        })}
      </div>

      {filtered.length === 0 && (
        <EmptyState
          icon={<BookOpen />}
          title={runbooks.length ? 'No matching runbooks' : 'No runbooks yet'}
          description="Create reusable diagnostics and remediation workflows to accelerate operational response."
          action={canManage ? <CreateRunbookDialog /> : undefined}
        />
      )}
    </section>
  );
}
