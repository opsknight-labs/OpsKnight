'use client';

import { useMemo, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutGrid, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  deleteStatusDashboardAction,
  saveStatusDashboardAction,
} from '@/app/(app)/status-dashboard/actions';

export type ManagedDashboard = {
  id: string;
  name: string;
  slug: string;
  businessServiceIds: string[];
};

type Draft = { id: string | null; name: string; slug: string; businessServiceIds: string[] };

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

function DashboardForm({
  draft,
  businessServices,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  businessServices: readonly { id: string; name: string }[];
  onCancel: () => void;
  onSaved: (slug: string) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [slug, setSlug] = useState(draft.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(draft.id));
  const [selected, setSelected] = useState<string[]>(draft.businessServiceIds);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = new Set(selected);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return businessServices.filter(item => !needle || item.name.toLowerCase().includes(needle));
  }, [businessServices, query]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveStatusDashboardAction(draft.id, {
        name,
        slug,
        businessServiceIds: selected,
      });
      if (result.ok) {
        notify.success(draft.id ? 'Dashboard saved' : 'Dashboard created');
        onSaved(result.slug);
      } else setError(result.error);
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      aria-describedby={error ? 'dashboard-error' : undefined}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dashboard-name">Name</Label>
          <Input
            id="dashboard-name"
            value={name}
            required
            maxLength={80}
            onChange={event => {
              setName(event.target.value);
              if (!slugTouched) setSlug(slugify(event.target.value));
            }}
            placeholder="Payments leadership"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dashboard-slug">URL</Label>
          <Input
            id="dashboard-slug"
            value={slug}
            required
            maxLength={60}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            aria-describedby="dashboard-slug-help"
            onChange={event => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
          />
          <p id="dashboard-slug-help" className="truncate text-xs text-muted-foreground">
            /status-dashboard/{slug || 'your-dashboard'}
          </p>
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Business services{' '}
          <span className="font-normal text-muted-foreground tabular-nums">
            ({selected.length})
          </span>
        </legend>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search business services"
            aria-label="Search business services"
            className="h-9 pl-8"
          />
        </div>
        <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border">
          {visible.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              No business services match.
            </li>
          ) : (
            visible.map(item => (
              <li key={item.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                  <Checkbox
                    checked={chosen.has(item.id)}
                    onCheckedChange={checked =>
                      setSelected(current =>
                        checked === true
                          ? [...current, item.id]
                          : current.filter(entry => entry !== item.id)
                      )
                    }
                  />
                  {item.name}
                </label>
              </li>
            ))
          )}
        </ul>
      </fieldset>
      {error && (
        <p id="dashboard-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" loading={pending}>
          {draft.id ? 'Save dashboard' : 'Create dashboard'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "Manage dashboards" dialog for OPERATIONS_MANAGE: list, create, edit and delete custom boards. */
export default function StatusDashboardManager({
  dashboards,
  businessServices,
  triggerClassName,
}: {
  dashboards: readonly ManagedDashboard[];
  businessServices: readonly { id: string; name: string }[];
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) setDraft(null);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button size="sm" className={cn('gap-1.5', triggerClassName)}>
          <Settings2 className="h-4 w-4" aria-hidden />
          Manage dashboards
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {draft ? (draft.id ? `Edit ${draft.name}` : 'New dashboard') : 'Status dashboards'}
          </DialogTitle>
          <DialogDescription>
            {draft
              ? 'Pick the business services this board shows. People only see the ones they can access.'
              : 'Custom boards show a chosen set of business services, for a team, a product or leadership.'}
          </DialogDescription>
        </DialogHeader>
        {draft ? (
          <DashboardForm
            key={draft.id ?? 'new'}
            draft={draft}
            businessServices={businessServices}
            onCancel={() => setDraft(null)}
            onSaved={slug => {
              close(false);
              router.push(`/status-dashboard/${slug}`);
              router.refresh();
            }}
          />
        ) : (
          <div className="space-y-3">
            {dashboards.length === 0 ? (
              <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No custom dashboards yet. Everyone can always see the board of all business
                services.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border">
                {dashboards.map(dashboard => (
                  <li key={dashboard.id} className="flex items-center gap-2 px-3 py-2">
                    <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <Link
                      href={`/status-dashboard/${dashboard.slug}`}
                      onClick={() => close(false)}
                      className="min-w-0 flex-1 truncate text-sm font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {dashboard.name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {dashboard.businessServiceIds.length} services
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Edit ${dashboard.name}`}
                      onClick={() => setDraft({ ...dashboard })}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <DeleteConfirmDialog
                      title={`Delete ${dashboard.name}?`}
                      description="The board and its link go away. Business services and their health are not affected."
                      confirmText="Delete dashboard"
                      trigger={
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={`Delete ${dashboard.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      }
                      onConfirm={async () => {
                        const result = await deleteStatusDashboardAction(dashboard.id);
                        if (!result.ok) return { error: result.error };
                        notify.success('Dashboard deleted');
                        router.refresh();
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button
                type="button"
                className="gap-1.5"
                onClick={() => setDraft({ id: null, name: '', slug: '', businessServiceIds: [] })}
              >
                <Plus className="h-4 w-4" aria-hidden />
                New dashboard
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
