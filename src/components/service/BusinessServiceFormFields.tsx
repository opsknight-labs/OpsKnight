'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import ConfirmDialog from '@/components/ConfirmDialog';

type LinkRow = { label: string; url: string };

/** "Label | URL" lines (the form's stored shape) to rows, and back. */
export function linkRowsFromText(text: string | undefined): LinkRow[] {
  return (text ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const at = line.indexOf('|');
      return at < 0
        ? { label: '', url: line }
        : { label: line.slice(0, at).trim(), url: line.slice(at + 1).trim() };
    });
}

export const linkRowsToText = (rows: readonly LinkRow[]) =>
  rows
    .filter(row => row.label.trim() || row.url.trim())
    .map(row => `${row.label.trim()} | ${row.url.trim()}`)
    .join('\n');

const MAX_LINKS = 10;

/** Repeatable label + URL rows. Rows live here so a half-typed row survives re-renders. */
export function LinkRowsField({
  id,
  text,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  text: string;
  onChange: (text: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [rows, setRows] = useState<LinkRow[]>(() => {
    const parsed = linkRowsFromText(text);
    return parsed.length ? parsed : [{ label: '', url: '' }];
  });
  const update = (next: LinkRow[]) => {
    setRows(next);
    onChange(linkRowsToText(next));
  };
  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-label="Links">
        {rows.map((row, index) => (
          <li key={index} className="flex items-center gap-2">
            <Input
              id={index === 0 ? id : undefined}
              aria-label={`Link ${index + 1} label`}
              value={row.label}
              placeholder="Runbook"
              maxLength={80}
              className="h-9 w-32 shrink-0 sm:w-40"
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={event =>
                update(rows.map((r, i) => (i === index ? { ...r, label: event.target.value } : r)))
              }
            />
            <Input
              aria-label={`Link ${index + 1} URL`}
              value={row.url}
              placeholder="https://wiki.example.com/checkout"
              inputMode="url"
              className="h-9 min-w-0 flex-1"
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={event =>
                update(rows.map((r, i) => (i === index ? { ...r, url: event.target.value } : r)))
              }
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-muted-foreground"
              aria-label={`Remove link ${index + 1}`}
              onClick={() => {
                const next = rows.filter((_, i) => i !== index);
                update(next.length ? next : [{ label: '', url: '' }]);
              }}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {rows.length < MAX_LINKS && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setRows([...rows, { label: '', url: '' }])}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add link
        </Button>
      )}
    </div>
  );
}

/** Tags as chips: Enter or comma adds, Backspace on an empty input removes the last. */
export function TagChipsField({
  id,
  text,
  onChange,
}: {
  id: string;
  /** Comma separated, the form's stored shape. */
  text: string;
  onChange: (text: string) => void;
}) {
  const tags = (text ?? '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
  const [draft, setDraft] = useState('');
  const commit = (raw: string) => {
    const fresh = raw
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag && !tags.some(existing => existing.toLowerCase() === tag.toLowerCase()));
    if (fresh.length) onChange([...tags, ...fresh].join(', '));
    setDraft('');
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1).join(', '));
    }
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      <ul aria-label="Selected tags" className="contents">
        {tags.map(tag => (
          <li
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-2 pr-1 text-xs"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onChange(tags.filter(existing => existing !== tag).join(', '))}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <input
        id={id}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={keyDown}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={tags.length ? 'Add a tag' : 'payments, pci'}
        className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
      />
    </div>
  );
}

/**
 * Warns before leaving with unsaved changes: the browser prompt on reload or close, and a dialog
 * for in-app links (captured before Next handles them). Same-page hash links stay free.
 */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const url = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (
        url.origin === current.origin &&
        url.pathname === current.pathname &&
        url.search === current.search
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(
        url.origin === current.origin ? url.pathname + url.search + url.hash : url.href
      );
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);
  return (
    <ConfirmDialog
      isOpen={destination !== null}
      variant="warning"
      title="Leave with unsaved changes?"
      message="Your changes to this business service are not saved yet. Leaving discards them."
      confirmText="Discard and leave"
      cancelText="Keep editing"
      onCancel={() => setDestination(null)}
      onConfirm={() => {
        const target = destination;
        setDestination(null);
        if (!target) return;
        if (/^https?:/.test(target)) window.location.assign(target);
        else router.push(target);
      }}
    />
  );
}
