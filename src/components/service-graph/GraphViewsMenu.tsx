'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bookmark, Check, Copy, Link2Off, Share2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { notify } from '@/lib/toast';
import {
  createGraphViewAction,
  deleteGraphViewAction,
  listGraphViewsAction,
  revokeGraphShareAction,
  shareGraphViewAction,
} from '@/app/(app)/services/graph/actions';
import { readViewConfig } from './insights';

type SavedView = {
  id: string;
  name: string;
  ownerId: string;
  visibility: 'PRIVATE' | 'TEAM' | 'ORG';
  teamId: string | null;
  config: unknown;
  shared: boolean;
};
export type AppliedView = { focus: string | null; hops: number | null; search: string };

const LEGACY_KEY = 'opsknight:service-graph:views';
const VISIBILITY_LABEL = { PRIVATE: 'Only me', TEAM: 'My team', ORG: 'Everyone' } as const;

function legacyViews(): Array<{ name: string; search: string }> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed
          .filter(v => typeof v?.name === 'string' && typeof v?.search === 'string')
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

/**
 * Saved views, kept on the server and shared by visibility (only me / my team / everyone). The
 * current view is always in the URL too. Admins can share a read-only, anonymized embed link.
 */
export default function GraphViewsMenu({
  focus,
  hops,
  currentSearch,
  currentMode,
  onApply,
  userId,
  teams,
  canOrg,
  isAdmin,
  embedEnabled,
}: {
  focus: string | null;
  hops: number;
  /** The client-side filter state as a query string. */
  currentSearch: () => string;
  currentMode: 'graph' | 'list';
  onApply: (view: AppliedView) => void;
  userId: string;
  /** Teams the viewer belongs to, for team-visible views. */
  teams: ReadonlyArray<{ id: string; name: string }>;
  /** May publish views to everyone. */
  canOrg: boolean;
  isAdmin: boolean;
  embedEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'TEAM' | 'ORG'>('PRIVATE');
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ viewName: string; url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [legacy, setLegacy] = useState<Array<{ name: string; search: string }>>([]);

  const load = useCallback(async () => {
    const result = await listGraphViewsAction();
    if (result.ok) setViews(result.data as SavedView[]);
    else notify.error(result.message);
  }, []);
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state with the prop/open transition; cannot be derived during render
    void load();
    setLegacy(legacyViews());
  }, [open, load]);

  const config = (search: string) => {
    const params = new URLSearchParams(search);
    const status = params.get('status');
    const origin = params.get('origin');
    const team = params.get('team');
    return {
      focus,
      hops,
      mode: currentMode,
      filters: {
        ...(status && { statuses: [status] }),
        ...(origin === 'DECLARED' || origin === 'OBSERVED' ? { origins: [origin] } : {}),
        ...(team && { teamIds: [team] }),
      },
      search,
    };
  };

  const save = async () => {
    const label = name.trim();
    if (!label || busy) return;
    setBusy(true);
    const result = await createGraphViewAction({
      name: label,
      visibility,
      ...(visibility === 'TEAM' && { teamId }),
      config: config(currentSearch()),
    });
    setBusy(false);
    if (!result.ok) return notify.error(result.message);
    setName('');
    await load();
  };

  const importLegacy = async () => {
    setBusy(true);
    let failed = 0;
    for (const view of legacy) {
      const result = await createGraphViewAction({
        name: view.name.slice(0, 120),
        visibility: 'PRIVATE',
        config: config(view.search),
      });
      if (!result.ok) failed += 1;
    }
    setBusy(false);
    if (failed === 0) {
      try {
        window.localStorage.removeItem(LEGACY_KEY);
      } catch {
        // Blocked storage: the views stay there and can be imported again.
      }
      setLegacy([]);
    } else notify.error(`${failed} of ${legacy.length} views could not be imported.`);
    await load();
  };

  const remove = async (view: SavedView) => {
    const result = await deleteGraphViewAction({ id: view.id });
    if (!result.ok) return notify.error(result.message);
    setViews(current => current?.filter(other => other.id !== view.id) ?? null);
  };

  const share = async (view: SavedView) => {
    const result = await shareGraphViewAction({ id: view.id, expiresInDays: 30 });
    if (!result.ok) return notify.error(result.message);
    setCopied(false);
    setLink({
      viewName: view.name,
      url: `${window.location.origin}/graph-embed/${result.data.token}`,
      expiresAt: result.data.expiresAt,
    });
    await load();
  };

  const revoke = async (view: SavedView) => {
    const result = await revokeGraphShareAction({ id: view.id });
    if (!result.ok) return notify.error(result.message);
    if (link?.viewName === view.name) setLink(null);
    notify.success('Share link revoked.');
    await load();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Bookmark className="h-4 w-4" aria-hidden="true" /> Views
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <form
          className="space-y-2"
          onSubmit={event => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex gap-2">
            <Input
              aria-label="Name for this view"
              placeholder="Name this view"
              value={name}
              maxLength={120}
              onChange={event => setName(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={!name.trim() || busy}>
              Save
            </Button>
          </div>
          <div className="flex gap-2">
            <Select value={visibility} onValueChange={value => setVisibility(value as typeof visibility)}>
              <SelectTrigger aria-label="Who can see this view" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PRIVATE">{VISIBILITY_LABEL.PRIVATE}</SelectItem>
                {teams.length > 0 && <SelectItem value="TEAM">{VISIBILITY_LABEL.TEAM}</SelectItem>}
                {canOrg && <SelectItem value="ORG">{VISIBILITY_LABEL.ORG}</SelectItem>}
              </SelectContent>
            </Select>
            {visibility === 'TEAM' && (
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger aria-label="Team" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teams.map(team => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </form>

        {legacy.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-2 text-xs">
            <p>
              {legacy.length} view{legacy.length === 1 ? ' is' : 's are'} saved only in this browser.
            </p>
            <Button size="sm" variant="outline" className="mt-1.5" disabled={busy} onClick={() => void importLegacy()}>
              Move to my saved views
            </Button>
          </div>
        )}

        {views === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : views.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Saved views keep your focus, search and filters for next time.
          </p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {views.map(view => {
              const mine = view.ownerId === userId;
              return (
                <li key={view.id} className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 flex-col items-start py-1"
                    onClick={() => {
                      onApply(readViewConfig(view.config));
                      setOpen(false);
                    }}
                  >
                    <span className="max-w-full truncate">{view.name}</span>
                    <span className="text-2xs font-normal text-muted-foreground">
                      {VISIBILITY_LABEL[view.visibility]}
                      {view.shared && ' · shared link'}
                    </span>
                  </Button>
                  {isAdmin && embedEnabled && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Share a read-only link to ${view.name}`}
                      onClick={() => void share(view)}
                    >
                      <Share2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  {view.shared && (mine || isAdmin) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Revoke the share link for ${view.name}`}
                      onClick={() => void revoke(view)}
                    >
                      <Link2Off className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  {(mine || isAdmin) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Delete view ${view.name}`}
                      onClick={() => void remove(view)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {isAdmin && !embedEnabled && (
          <p className="text-2xs text-muted-foreground">
            Read-only share links are off. Turn them on in Settings, Intelligence, Services & changes.
          </p>
        )}
        {link && (
          <div className="space-y-1.5 rounded-md border bg-muted/40 p-2">
            <p className="text-xs font-medium">Read-only link for {link.viewName}</p>
            <p className="text-2xs text-muted-foreground">
              Shown once. Anyone with it sees an anonymized graph until {new Date(link.expiresAt).toLocaleDateString()}.
            </p>
            <div className="flex gap-1.5">
              <Input aria-label="Share link" readOnly value={link.url} onFocus={event => event.currentTarget.select()} className="h-8 text-xs" />
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                aria-label="Copy link"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(link.url)
                    .then(() => setCopied(true))
                    .catch(() => notify.error('Copy failed. Select the link and copy it.'));
                }}
              >
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
