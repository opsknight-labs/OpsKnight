'use client';

import {
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowUp, Square } from 'lucide-react';
import type { SlashCommand } from './slash-commands';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';

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
}) {
  const [active, setActive] = useState(0);
  // Escape hides the list for the text it was pressed on; typing more brings it back.
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const menuOpen = commands.length > 0 && closedFor !== value && Boolean(onCommand);
  const current = Math.min(active, commands.length - 1);
  const listId = `${inputId}-commands`;
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current + step + commands.length) % commands.length);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        setActive(0);
        const command = commands.at(current);
        if (command) onCommand?.(command);
        return;
      }
      if (event.key === 'Escape') {
        // Prevented, so the panel's own Escape handler leaves the chat open.
        event.preventDefault();
        setClosedFor(value);
        return;
      }
    }
    onKeyDown(event);
  };
  const sendSize = fullscreen ? 'h-11 w-11' : 'h-11 w-11 sm:h-8 sm:w-8';
  return (
    <form
      onSubmit={onSubmit}
      className="relative shrink-0 border-t border-border bg-card px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3"
    >
      {menuOpen && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="absolute inset-x-3 bottom-full z-10 mb-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {commands.map((command, index) => (
            <li
              key={command.name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              // Keep focus in the field; the click still picks the command.
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                setActive(0);
                onCommand?.(command);
              }}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-sm sm:min-h-8 ${index === current ? 'bg-accent text-accent-foreground' : ''}`}
            >
              <span className="w-20 shrink-0 font-mono text-xs font-semibold">/{command.name}</span>
              <span className="min-w-0 truncate text-muted-foreground">{command.hint}</span>
            </li>
          ))}
        </ul>
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
        {chips && <div className="flex flex-wrap items-center gap-1.5">{chips}</div>}
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
            aria-autocomplete={onCommand ? 'list' : undefined}
            aria-controls={menuOpen ? listId : undefined}
            aria-activedescendant={menuOpen ? `${listId}-${current}` : undefined}
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
        <span className="hidden shrink-0 sm:inline">Enter to send · / for commands</span>
        <span className="shrink-0 tabular-nums sm:hidden">
          {value.length}/{maxLength}
        </span>
      </p>
    </form>
  );
}
