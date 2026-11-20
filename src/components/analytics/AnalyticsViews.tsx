'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bookmark, ChevronDown, Mail, Plus, Star, Users } from 'lucide-react';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  createAnalyticsViewAction,
  deleteAnalyticsViewAction,
  renameAnalyticsViewAction,
  setAnalyticsViewWeeklyEmailAction,
  setDefaultAnalyticsViewAction,
  type ViewActionResult,
} from '@/app/(app)/insights/view-actions';
import {
  DEFAULT_ANALYTICS_RANGE,
  parseAnalyticsParams,
  toAnalyticsSearchParams,
} from '@/lib/analytics/params';
import type { AnalyticsViewSummary } from '@/lib/analytics/views';
import { notify } from '@/lib/toast';

type Team = { id: string; name: string };
type Editing = { mode: 'save' } | { mode: 'rename'; view: AnalyticsViewSummary } | null;
const PRIVATE = 'private';

export default function AnalyticsViews({
  views,
  teams,
}: {
  views: AnalyticsViewSummary[];
  /** Teams the user belongs to; a view can be shared with one of them. */
  teams: Team[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<AnalyticsViewSummary | null>(null);
  const currentQuery = toAnalyticsSearchParams(parseAnalyticsParams(searchParams)).toString();
  const active = views.find(view => view.query === currentQuery);
  const open = (query: string) => router.push(query ? `${pathname}?${query}` : pathname);

  const act = (work: () => Promise<ViewActionResult>, success: string) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        notify.success(success);
        router.refresh();
      } else notify.error(result.error);
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 max-w-[220px] gap-2"
            disabled={isPending}
          >
            <Bookmark className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{active ? active.name : 'Views'}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views.length === 0 && (
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              Save the current filters to reopen them in one click.
            </p>
          )}
          {views.map(view =>
            view.isOwner ? (
              <DropdownMenuSub key={view.id}>
                <DropdownMenuSubTrigger className="gap-2">
                  <ViewLabel view={view} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuItem onSelect={() => open(view.query)}>Open</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditing({ mode: 'rename', view })}>
                    Rename…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      act(
                        () => setDefaultAnalyticsViewAction(view.isDefault ? null : view.id),
                        view.isDefault
                          ? 'Default view cleared'
                          : `"${view.name}" is now your default`
                      )
                    }
                  >
                    {view.isDefault ? 'Remove as default' : 'Set as default'}
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem
                    checked={view.emailWeekly}
                    onCheckedChange={checked =>
                      act(
                        () => setAnalyticsViewWeeklyEmailAction(view.id, checked),
                        checked ? 'Weekly email on. It arrives each Monday.' : 'Weekly email off'
                      )
                    }
                  >
                    <Mail className="mr-2 h-4 w-4" aria-hidden />
                    Weekly email
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDeleting(view)}
                  >
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem key={view.id} className="gap-2" onSelect={() => open(view.query)}>
                <ViewLabel view={view} />
              </DropdownMenuItem>
            )
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2" onSelect={() => setEditing({ mode: 'save' })}>
            <Plus className="h-4 w-4" aria-hidden />
            Save current view…
          </DropdownMenuItem>
          {views.some(view => view.isDefault) && (
            // An explicit range keeps the default-view redirect from firing.
            <DropdownMenuItem onSelect={() => open(`range=${DEFAULT_ANALYTICS_RANGE}`)}>
              Show all incidents
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ViewDialog
        editing={editing}
        teams={teams}
        pending={isPending}
        onClose={() => setEditing(null)}
        onSubmit={(name, teamId) => {
          const target = editing;
          startTransition(async () => {
            const result =
              target?.mode === 'rename'
                ? await renameAnalyticsViewAction(target.view.id, name)
                : await createAnalyticsViewAction({
                    name,
                    query: currentQuery,
                    visibility: teamId ? 'TEAM' : 'PRIVATE',
                    teamId,
                  });
            if (!result.ok) return void notify.error(result.error);
            notify.success(target?.mode === 'rename' ? 'View renamed' : 'View saved');
            setEditing(null);
            router.refresh();
          });
        }}
      />

      <DeleteConfirmDialog
        open={deleting !== null}
        onOpenChange={value => !value && setDeleting(null)}
        title="Delete view?"
        description={`"${deleting?.name ?? ''}" will be removed for you${
          deleting?.visibility === 'TEAM' ? ' and your team' : ''
        }${deleting?.emailWeekly ? ', and its weekly email stops' : ''}. Filters on the page are not changed.`}
        confirmText="Delete view"
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteAnalyticsViewAction(deleting.id);
          if (!result.ok) return { error: result.error };
          notify.success('View deleted');
          setDeleting(null);
          router.refresh();
        }}
      />
    </>
  );
}

function ViewLabel({ view }: { view: AnalyticsViewSummary }) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{view.name}</span>
      {view.isDefault && (
        <Star className="h-3.5 w-3.5 text-muted-foreground" aria-label="Default" />
      )}
      {view.visibility === 'TEAM' && (
        <Users
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-label={view.teamName ? `Shared with ${view.teamName}` : 'Shared with team'}
        />
      )}
    </>
  );
}

function ViewDialog({
  editing,
  teams,
  pending,
  onClose,
  onSubmit,
}: {
  editing: Editing;
  teams: Team[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string, teamId: string | null) => void;
}) {
  const renaming = editing?.mode === 'rename';
  const [prev, setPrev] = useState<Editing>(null);
  const [name, setName] = useState('');
  const [share, setShare] = useState(PRIVATE);
  if (editing !== prev) {
    setPrev(editing);
    setName(editing?.mode === 'rename' ? editing.view.name : '');
    setShare(PRIVATE);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(name.trim(), share === PRIVATE ? null : share);
  };

  return (
    <Dialog open={editing !== null} onOpenChange={value => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{renaming ? 'Rename view' : 'Save current view'}</DialogTitle>
            <DialogDescription>
              {renaming
                ? 'The filters stay the same.'
                : 'Saves the current time range and filters so you can reopen them later.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="analytics-view-name">Name</Label>
            <Input
              id="analytics-view-name"
              value={name}
              maxLength={80}
              required
              autoFocus
              onChange={event => setName(event.target.value)}
              placeholder="e.g. Payments, high urgency"
            />
          </div>
          {!renaming && teams.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="analytics-view-share">Visible to</Label>
              <Select value={share} onValueChange={setShare}>
                <SelectTrigger id="analytics-view-share">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PRIVATE}>Only me</SelectItem>
                  {teams.map(team => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {renaming ? 'Rename' : 'Save view'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
