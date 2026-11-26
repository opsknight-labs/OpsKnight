'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Bookmark, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';

type View = { name: string; href: string };
const MAX_VIEWS = 8;
const EVENT = 'opsknight:bs-views';

const parse = (raw: string): View[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (v): v is View =>
            typeof v?.name === 'string' &&
            typeof v?.href === 'string' &&
            // The catalog itself only: not /services/businessX or a detail page.
            (v.href === '/services/business' || v.href.startsWith('/services/business?'))
        )
      : [];
  } catch {
    return [];
  }
};
const write = (key: string, views: View[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(views.slice(0, MAX_VIEWS)));
  } catch {
    // Storage blocked: the view just is not remembered.
  }
  window.dispatchEvent(new Event(EVENT));
};
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

/**
 * Saved filter views. The URL is the view (shareable); the list of names lives in this browser, per user.
 * shortcut: localStorage only, so views do not follow the user across devices; move to a user setting
 * when that is wanted.
 */
export default function SavedViews({
  userId,
  currentHref,
  filtered,
}: {
  userId: string;
  /** The current filters as a catalog URL, without pagination. */
  currentHref: string;
  filtered: boolean;
}) {
  const key = `opsknight:bs-catalog-views:${userId}`;
  // The raw string is the snapshot, so it is stable between renders.
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key) ?? '[]';
      } catch {
        return '[]';
      }
    },
    () => '[]'
  );
  const views = parse(raw);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [announce, setAnnounce] = useState('');
  const groupRef = useRef<HTMLDivElement>(null);

  if (!views.length && !filtered) return null;
  const save = () => {
    const label = name.trim().slice(0, 40);
    if (!label) return;
    write(key, [{ name: label, href: currentHref }, ...views.filter(v => v.name !== label)]);
    setName('');
    setNaming(false);
    setAnnounce(`Saved view ${label}`);
    // The Save control and the name field unmount; keep keyboard focus inside the group.
    groupRef.current?.focus();
  };
  return (
    <div
      ref={groupRef}
      tabIndex={-1}
      className="flex flex-wrap items-center gap-2 text-xs focus-visible:outline-hidden"
      role="group"
      aria-label="Saved views"
    >
      <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
        <Bookmark className="h-3.5 w-3.5" aria-hidden />
        Views
      </span>
      <span role="status" className="sr-only">
        {announce}
      </span>
      {views.map(view => (
        <span
          key={view.name}
          className="inline-flex items-center rounded-full border bg-card pl-3 text-xs"
        >
          <Link
            href={view.href}
            aria-current={view.href === currentHref ? 'true' : undefined}
            className="py-1 font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {view.name}
          </Link>
          <button
            type="button"
            aria-label={`Remove saved view ${view.name}`}
            onClick={() => {
              write(
                key,
                views.filter(v => v.name !== view.name)
              );
              setAnnounce(`Removed saved view ${view.name}`);
              groupRef.current?.focus();
            }}
            className="ml-1 rounded-full p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {filtered &&
        (naming ? (
          <form
            className="inline-flex items-center gap-1"
            onSubmit={event => {
              event.preventDefault();
              save();
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={event => setName(event.target.value)}
              onKeyDown={event => event.key === 'Escape' && setNaming(false)}
              aria-label="Name for this view"
              maxLength={40}
              className="h-8 w-40 rounded-md border bg-background px-2 text-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="sm" className="h-8 text-xs">
              Save
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => setNaming(true)}
          >
            Save this view
          </Button>
        ))}
    </div>
  );
}
