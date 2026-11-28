'use client';

import {
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowUp, Square, X } from 'lucide-react';
import type { SlashCommand } from './slash-commands';
import type { SquireMentionKind } from '@/lib/intelligence/squire/contract';
import { useEntitySearch } from '@/components/command-palette/use-entity-search';
import type { SearchResult } from '@/components/command-palette/palette-model';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';

/** A record picked with "@": sent as `{kind, id}`, shown as a chip with its label. */
export interface SquireMention {
  kind: SquireMentionKind;
  id: string;
  label: string;
}

export const MAX_MENTIONS = 5;

const MENTION_KIND: Partial<Record<SearchResult['type'], SquireMentionKind>> = {
  incident: 'incident',
  service: 'service',
  schedule: 'schedule',
  team: 'team',
  runbook: 'runbook',
  user: 'person',
};

/** Order of kinds in the @ list. */
const MENTION_RANK: ReadonlyArray<SearchResult['type']> = [
  'service',
  'team',
  'runbook',
  'schedule',
  'user',
  'incident',
];

/** "@" and at least the search's two characters, at the end of the text, with no space yet. */
const MENTION_QUERY = /(?:^|\s)@([^\s@]{2,40})$/;

/**
 * The message box: attached context chips above a one-line field that grows with the text, the send (or
 * stop) button inside the box, and one muted line about privacy and keys underneath. Typing "/" opens a
 * small command list; the field keeps focus and points at the highlighted command.
 */
export default function SquireComposer({
  name,
  inputId,
  inputRef,
  value,
  maxLength,
  placeholder,
  onChange,
  onSubmit,
  onKeyDown,
  busy,
  canSend,
  onStop,
  editing,
  onCancelEdit,
  chips,
  retentionDays,
  fullscreen,
  commands = [],
  onCommand,
  mentions = [],
  onMentionsChange,
}: {
  name: string;
  inputId: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  maxLength: number;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  busy: boolean;
  canSend: boolean;
  onStop: () => void;
  editing: boolean;
  onCancelEdit: () => void;
  /** Context attached to the next message (the incident, a handed-over finding). */
  chips: ReactNode;
  /** Days saved conversations are kept; null when history is off. */
  retentionDays: number | null;
  fullscreen: boolean;
  /** Commands matching what is typed (see slash-commands); the list shows while there are any. */
  commands?: readonly SlashCommand[];
  onCommand?: (command: SlashCommand) => void;
  /** Records picked with "@" for the next message; typing "@" offers them while this is set. */
  mentions?: readonly SquireMention[];
  onMentionsChange?: (mentions: SquireMention[]) => void;
}) {
  const [active, setActive] = useState(0);
  // Escape hides the list for the text it was pressed on; typing more brings it back.
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const menuOpen = commands.length > 0 && closedFor !== value && Boolean(onCommand);
  const mentionQuery =
    onMentionsChange && !menuOpen && mentions.length < MAX_MENTIONS
      ? (MENTION_QUERY.exec(value)?.[1] ?? '')
      : '';
  const search = useEntitySearch(mentionQuery);
  // Named things first (a service or team is what people usually mean); the many incidents come last.
  const found = mentionQuery
    ? search.results
        .filter(result => MENTION_KIND[result.type])
        .map((result, position) => ({ result, position }))
        .sort(
          (a, b) =>
            MENTION_RANK.indexOf(a.result.type) - MENTION_RANK.indexOf(b.result.type) ||
            a.position - b.position
        )
        .map(item => item.result)
        .slice(0, 8)
    : [];
  // While "@text" is typed the popup shows results, "Searching…" or "No matches".
  const mentionPanel = Boolean(mentionQuery) && closedFor !== value;
  const mentionOpen = mentionPanel && found.length > 0;
  const listOpen = menuOpen || mentionOpen;
  const count = menuOpen ? commands.length : found.length;
  const current = Math.min(active, count - 1);
  const listId = `${inputId}-${menuOpen ? 'commands' : 'mentions'}`;
  const pickMention = (result: SearchResult) => {
    const kind = MENTION_KIND[result.type];
    if (!kind) return;
    const label = result.title.replace(/\s+/g, ' ').trim().slice(0, 80);
    onChange(value.replace(/@[^\s@]{2,40}$/, `@${label} `).slice(0, maxLength));
    if (!mentions.some(mention => mention.kind === kind && mention.id === result.id))
      onMentionsChange?.([...mentions, { kind, id: result.id, label }]);
  };
  const pick = (index: number) => {
    setActive(0);
    if (menuOpen) {
      const command = commands.at(index);
      if (command) onCommand?.(command);
    } else {
      const result = found.at(index);
      if (result) pickMention(result);
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (listOpen && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current + step + count) % count);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        pick(current);
        return;
      }
    }
    if ((listOpen || mentionPanel) && event.key === 'Escape') {
      // Prevented, so the panel's own Escape handler leaves the chat open.
      event.preventDefault();
      setClosedFor(value);
      return;
    }
    onKeyDown(event);
  };
  const sendSize = fullscreen ? 'h-11 w-11' : 'h-11 w-11 sm:h-8 sm:w-8';
  return (
    <form
      onSubmit={onSubmit}
      className="relative shrink-0 border-t border-border bg-card px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3"
    >
      {listOpen && (
        <ul
          id={listId}
          role="listbox"
          aria-label={menuOpen ? 'Commands' : 'Mention a record'}
          className="absolute inset-x-3 bottom-full z-10 mb-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {mentionOpen &&
            found.map((result, index) => (
              <li
                key={`${result.type}:${result.id}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === current}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-sm sm:min-h-8 ${index === current ? 'bg-accent text-accent-foreground' : ''}`}
              >
                <span className="min-w-0 flex-1 truncate">{result.title}</span>
                {(result.subtitle || result.type === 'incident') && (
                  // Tells apart records with the same title: the short id Squire uses in answers, then status and service.
                  <span className="max-w-[50%] shrink truncate text-xs text-muted-foreground">
                    {result.type === 'incident' ? `#${result.id.slice(-5).toUpperCase()} · ` : ''}
                    {result.subtitle}
                  </span>
                )}
                <span className="shrink-0 text-xs capitalize text-muted-foreground">
                  {MENTION_KIND[result.type]}
                </span>
              </li>
            ))}
          {menuOpen &&
            commands.map((command, index) => (
              <li
                key={command.name}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === current}
                // Keep focus in the field; the click still picks the command.
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-sm sm:min-h-8 ${index === current ? 'bg-accent text-accent-foreground' : ''}`}
              >
                <span className="w-20 shrink-0 font-mono text-xs font-semibold">
                  /{command.name}
                </span>
                <span className="min-w-0 truncate text-muted-foreground">{command.hint}</span>
              </li>
            ))}
        </ul>
      )}
      {mentionPanel && !mentionOpen && (
        <p
          role="status"
          className="absolute inset-x-3 bottom-full z-10 mb-1 rounded-xl border border-border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg"
        >
          {search.loading ? 'Searching…' : search.failed ? 'Search is unavailable' : 'No matches'}
        </p>
      )}
      {editing && (
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Editing a question starts a new version of this chat.</span>
          <Button type="button" size="sm" variant="ghost" onClick={onCancelEdit}>
            Cancel edit
          </Button>
        </div>
      )}
      <div className="space-y-1.5 rounded-xl border border-border bg-background py-2 pl-3 pr-2 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
        {(chips || mentions.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips}
            {mentions.map(mention => (
              <span
                key={`${mention.kind}:${mention.id}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted py-0.5 pl-2 pr-0.5 text-xs"
              >
                <span className="truncate">@{mention.label}</span>
                <button
                  type="button"
                  aria-label={`Remove mention ${mention.label}`}
                  onClick={() => onMentionsChange?.(mentions.filter(other => other !== mention))}
                  // 44 px to tap on phones; a small cross in the desktop panel.
                  className="-my-3 inline-flex h-11 w-11 shrink-0 items-center sm:my-0 sm:h-5 sm:w-5 justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor={inputId} className="sr-only">
            Message {name}
          </label>
          <Textarea
            id={inputId}
            ref={inputRef}
            value={value}
            onChange={event => {
              setActive(0);
              onChange(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            role={listOpen ? 'combobox' : undefined}
            aria-expanded={listOpen ? true : undefined}
            aria-autocomplete={onCommand || onMentionsChange ? 'list' : undefined}
            aria-controls={listOpen ? listId : undefined}
            aria-activedescendant={listOpen ? `${listId}-${current}` : undefined}
            maxLength={maxLength}
            rows={1}
            placeholder={placeholder}
            className="max-h-36 min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-1.5 text-sm shadow-none focus-visible:outline-hidden! focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {busy ? (
            <Button
              type="button"
              onClick={onStop}
              aria-label="Stop response"
              variant="secondary"
              size="icon"
              className={`${sendSize} shrink-0 rounded-lg`}
            >
              <Square aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              size="icon"
              className={`${sendSize} shrink-0 rounded-lg`}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 flex justify-between gap-3 px-1 text-2xs text-muted-foreground">
        <span className="truncate">
          {retentionDays === null
            ? 'History is off'
            : `Private to you · kept ${retentionDays} ${retentionDays === 1 ? 'day' : 'days'}`}
        </span>
        <span className="hidden shrink-0 sm:inline">
          Enter to send · / for commands{onMentionsChange ? ' · @ to mention' : ''}
        </span>
        <span className="shrink-0 tabular-nums sm:hidden">
          {value.length}/{maxLength}
        </span>
      </p>
      <p className="px-1 pt-1 text-center text-2xs font-normal text-muted-foreground">
        AI can be wrong. Check answers before you act on them.
      </p>
    </form>
  );
}
