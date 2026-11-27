'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileStack, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { EmptyState } from '@/components/patterns';
import { CRITICALITY_LABEL } from './HealthBadge';
import { notify } from '@/lib/toast';
import {
  createTemplateAction,
  deleteTemplateAction,
  updateTemplateAction,
} from '@/app/(app)/services/business/phase5b-actions';

export type TemplateView = {
  id: string;
  name: string;
  description: string | null;
  criticality: 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3' | null;
  sloTarget: number | null;
  sloWindowDays: number;
  tags: string[];
  environment: string | null;
  lifecycle: 'ACTIVE' | 'BETA' | 'DEPRECATED' | 'RETIRED';
  ownerTeamId: string | null;
  ownerTeamName: string | null;
};

const NONE = '__none__';
const TIERS = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'] as const;
const LIFECYCLES = ['ACTIVE', 'BETA', 'DEPRECATED', 'RETIRED'] as const;

type Draft = {
  name: string;
  description: string;
  criticality: string;
  sloTarget: string;
  tags: string;
  environment: string;
  lifecycle: (typeof LIFECYCLES)[number];
  ownerTeamId: string;
};
const EMPTY: Draft = {
  name: '',
  description: '',
  criticality: NONE,
  sloTarget: '',
  tags: '',
  environment: '',
  lifecycle: 'ACTIVE',
  ownerTeamId: NONE,
};

/** List, create, edit and delete business service templates (Responders and Admins). */
export default function TemplateManager({
  templates,
  teams,
}: {
  templates: readonly TemplateView[];
  teams: ReadonlyArray<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(current => ({ ...current, [key]: value }));

  const load = (template: TemplateView) => {
    setEditing(template.id);
    setError(null);
    setDraft({
      name: template.name,
      description: template.description ?? '',
      criticality: template.criticality ?? NONE,
      sloTarget: template.sloTarget === null ? '' : String(template.sloTarget),
      tags: template.tags.join(', '),
      environment: template.environment ?? '',
      lifecycle: template.lifecycle,
      ownerTeamId: template.ownerTeamId ?? NONE,
    });
    // The form sits beside the list; move focus to it so keyboard and screen-reader users land on the edit.
    // After the row menu has closed, which would otherwise keep focus.
    requestAnimationFrame(() => document.getElementById('tpl-name')?.focus());
  };
  const reset = () => {
    setEditing(null);
    setDraft(EMPTY);
    setError(null);
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError('Give the template a name.');
      return;
    }
    const slo = draft.sloTarget.trim() === '' ? null : Number(draft.sloTarget);
    if (slo !== null && !(slo >= 90 && slo <= 99.999)) {
      setError('SLO target must be between 90 and 99.999 percent.');
      return;
    }
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      criticality:
        draft.criticality === NONE ? null : (draft.criticality as (typeof TIERS)[number]),
      sloTarget: slo,
      tags: draft.tags
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean),
      environment: draft.environment.trim() || null,
      lifecycle: draft.lifecycle,
      ownerTeamId: draft.ownerTeamId === NONE ? null : draft.ownerTeamId,
    };
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateTemplateAction(editing, body)
        : await createTemplateAction(body);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success(editing ? 'Template updated' : 'Template created');
      reset();
      router.refresh();
    });
  };

  const [deleting, setDeleting] = useState<TemplateView | null>(null);
  const remove = async (template: TemplateView) => {
    const result = await deleteTemplateAction(template.id);
    if (!result.ok) return { error: result.error };
    notify.success('Template deleted');
    if (editing === template.id) reset();
    router.refresh();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section aria-label="Templates" className="rounded-lg border bg-card">
        {templates.length === 0 ? (
          <div className="p-6">
            <EmptyState
              variant="simple"
              size="sm"
              icon={<FileStack className="h-5 w-5" aria-hidden />}
              title="No templates yet"
              description="A template pre-fills criticality, SLO, tags and ownership for new business services. Create one with the form."
            />
          </div>
        ) : (
          <ul className="divide-y">
            {templates.map(template => (
              <li key={template.id} className="flex items-center gap-2 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{template.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      template.criticality ? CRITICALITY_LABEL[template.criticality] : null,
                      template.sloTarget === null ? null : `${template.sloTarget}% SLO`,
                      template.ownerTeamName,
                      template.tags.length ? template.tags.join(', ') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No defaults set'}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline" className="h-8">
                  <Link
                    href={`/services/business/new?template=${template.id}`}
                    aria-label={`Use template ${template.name}`}
                  >
                    Use
                  </Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      disabled={isPending}
                      aria-label={`More actions for ${template.name}`}
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  {/* Focus goes to the edit form or the delete dialog, not back to this trigger. */}
                  <DropdownMenuContent
                    align="end"
                    onCloseAutoFocus={event => event.preventDefault()}
                  >
                    <DropdownMenuItem onSelect={() => load(template)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDeleting(template)}
                    >
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
        <DeleteConfirmDialog
          open={deleting !== null}
          onOpenChange={open => !open && setDeleting(null)}
          title="Delete this template?"
          description={`${deleting?.name ?? 'This template'} will be removed. Business services already created from it are not affected.`}
          onConfirm={async () => {
            if (!deleting) return;
            const result = await remove(deleting);
            if (!result) setDeleting(null);
            return result;
          }}
        />
      </section>

      <form
        onSubmit={save}
        noValidate
        className="h-fit space-y-3 rounded-lg border bg-card p-4 text-sm"
        aria-label={editing ? 'Edit template' : 'New template'}
      >
        <h2 className="font-semibold">{editing ? 'Edit template' : 'New template'}</h2>
        <div className="space-y-1">
          <label htmlFor="tpl-name" className="text-xs font-semibold">
            Name
          </label>
          <Input
            id="tpl-name"
            value={draft.name}
            maxLength={120}
            onChange={event => set('name', event.target.value)}
            placeholder="Customer-facing API"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="tpl-description" className="text-xs font-semibold">
            Description
          </label>
          <Input
            id="tpl-description"
            value={draft.description}
            maxLength={2000}
            onChange={event => set('description', event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="tpl-tier" className="text-xs font-semibold">
              Criticality
            </label>
            <Select value={draft.criticality} onValueChange={value => set('criticality', value)}>
              <SelectTrigger id="tpl-tier" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {TIERS.map(tier => (
                  <SelectItem key={tier} value={tier}>
                    {tier.replace('TIER_', 'Tier ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="tpl-slo" className="text-xs font-semibold">
              SLO target (%)
            </label>
            <Input
              id="tpl-slo"
              value={draft.sloTarget}
              inputMode="decimal"
              placeholder="99.9"
              onChange={event => set('sloTarget', event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="tpl-team" className="text-xs font-semibold">
            Owner team
          </label>
          <Select value={draft.ownerTeamId} onValueChange={value => set('ownerTeamId', value)}>
            <SelectTrigger id="tpl-team" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {teams.map(team => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="tpl-env" className="text-xs font-semibold">
              Environment
            </label>
            <Input
              id="tpl-env"
              value={draft.environment}
              maxLength={40}
              placeholder="production"
              onChange={event => set('environment', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="tpl-lifecycle" className="text-xs font-semibold">
              Lifecycle
            </label>
            <Select
              value={draft.lifecycle}
              onValueChange={value => set('lifecycle', value as Draft['lifecycle'])}
            >
              <SelectTrigger id="tpl-lifecycle" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIFECYCLES.map(lifecycle => (
                  <SelectItem key={lifecycle} value={lifecycle}>
                    {lifecycle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="tpl-tags" className="text-xs font-semibold">
            Tags (comma separated)
          </label>
          <Input
            id="tpl-tags"
            value={draft.tags}
            placeholder="payments, pci"
            onChange={event => set('tags', event.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
            <Plus className="h-4 w-4" aria-hidden />
            {editing ? 'Save template' : 'Create template'}
          </Button>
          {editing && (
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
