import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import SquireBarCompanion from '@/components/squire/SquireBarCompanion';
import SquireComposer from '@/components/squire/SquireComposer';
import { buildNotes, nextNoteAt, type SquireNote } from '@/components/squire/squire-messages';
import { matchSlashCommands, type SlashCommand } from '@/components/squire/slash-commands';
import {
  emptyHeadline,
  formatLead,
  pendingLine,
  pickLine,
  presenceLabel,
} from '@/components/squire/squire-voice';

const NOW = Date.parse('2026-11-22T10:00:00Z');
const shift = (startMin: number, endMin: number, endClamped = false) => ({
  scheduleId: 'sch_1',
  scheduleName: 'Payments primary',
  start: new Date(NOW + startMin * 60_000).toISOString(),
  end: new Date(NOW + endMin * 60_000).toISOString(),
  endClamped,
});
const notesFor = (input: Partial<Parameters<typeof buildNotes>[0]> = {}) =>
  buildNotes({
    name: 'Pip',
    shortcut: '⌘J',
    tone: 'calm',
    shifts: [],
    now: NOW,
    answerReady: null,
    ...input,
  });

describe('Squire voice', () => {
  it('is playful when calm and plain in a high-urgency incident', () => {
    expect(emptyHeadline('calm', 19, 'Asha')).toBe('Good evening, Asha. What shall we look into?');
    expect(emptyHeadline('calm', 9, null)).toBe('Good morning. What shall we look into?');
    expect(emptyHeadline('crisp', 19, 'Asha')).toBe('What are we investigating?');
    expect(pendingLine('crisp', 3)).toBe('Investigating…');
    expect(pendingLine('calm', 3)).not.toBe('Investigating…');
    expect(presenceLabel('idle', 'Ready when you are', 'calm')).toBe('At your service');
    expect(presenceLabel('error', 'Response interrupted', 'calm')).toBe('Response interrupted');
    expect(presenceLabel('idle', 'Ready when you are', 'crisp')).toBe('Ready when you are');
  });

  it('picks the same line for the same seed', () => {
    expect(pickLine(['a', 'b', 'c'], 4)).toBe(pickLine(['a', 'b', 'c'], 4));
    expect(pickLine(['a', 'b', 'c'], -1)).toBe('b');
  });

  it('formats how long until something happens', () => {
    expect(formatLead(90 * 60_000)).toBe('1h 30m');
    expect(formatLead(45 * 60_000)).toBe('45m');
    expect(formatLead(120 * 60_000)).toBe('2h');
    expect(formatLead(20_000)).toBe('under a minute');
  });
});

describe('Squire notes', () => {
  it('always carries the introduction first', () => {
    const [intro] = notesFor();
    expect(intro).toMatchObject({ id: 'intro', keep: 'forever', dismissLabel: 'Later' });
    expect(intro.text).toContain("I'm Pip");
    expect(intro.text).toContain('⌘J');
  });

  it('gives an on-call heads-up within two hours of a shift, never earlier', () => {
    const soon = notesFor({ shifts: [shift(90, 600)] }).find(n => n.id.startsWith('on-call:'));
    expect(soon?.text).toBe(
      'Heads up, my knight: your watch on Payments primary begins in 1h 30m.'
    );
    expect(soon?.action).toEqual({ label: 'View schedule', href: '/schedules/sch_1' });
    const crisp = notesFor({ shifts: [shift(90, 600)], tone: 'crisp' }).at(-1);
    expect(crisp?.text).toBe('On call for Payments primary in 1h 30m.');
    expect(notesFor({ shifts: [shift(180, 600)] }).some(n => n.id.startsWith('on-call:'))).toBe(
      false
    );
  });

  it('warns before a real handoff but not at the lookahead limit', () => {
    const ending = notesFor({ shifts: [shift(-60, 20)] }).at(-1);
    expect(ending?.id).toMatch(/^handoff:/);
    expect(ending?.text).toContain('ends in 20m');
    expect(notesFor({ shifts: [shift(-60, 20, true)] })).toHaveLength(1);
  });

  it('wakes exactly when the next note becomes due', () => {
    expect(nextNoteAt([shift(180, 600)], NOW)).toBe(NOW + 60 * 60_000);
    expect(nextNoteAt([], NOW)).toBeNull();
  });

  it('adds "answer ready" once per finished answer', () => {
    const ready = notesFor({ answerReady: 7 }).find(n => n.id === 'ready:7');
    expect(ready).toMatchObject({ text: 'Your answer awaits, my knight.', keep: 'page' });
  });
});

describe('slash commands', () => {
  it('matches by prefix and keeps incident commands to incident chats', () => {
    expect(matchSlashCommands('/', false).map(c => c.name)).not.toContain('similar');
    expect(matchSlashCommands('/', true).map(c => c.name)).toContain('similar');
    expect(matchSlashCommands('/fi', false).map(c => c.name)).toEqual(['fire']);
    expect(matchSlashCommands('/fire now', false)).toEqual([]);
    expect(matchSlashCommands('what /fire', false)).toEqual([]);
    // Change commands are offered only on the page they act on.
    expect(matchSlashCommands('/re', false).map(c => c.name)).not.toContain('rename');
    expect(matchSlashCommands('/re', false, 'service').map(c => c.name)).toContain('rename');
    expect(matchSlashCommands('/ov', false, 'schedule').map(c => c.name)).toEqual(['override']);
    expect(matchSlashCommands('/ov', false, 'service')).toEqual([]);
  });

  it('opens a list from "/" that the keyboard can pick from or dismiss', () => {
    const picked: SlashCommand[] = [];
    function Harness() {
      const [value, setValue] = useState('');
      return (
        <SquireComposer
          name="Pip"
          inputId="squire-input"
          inputRef={{ current: null }}
          value={value}
          maxLength={2000}
          placeholder="Ask"
          onChange={setValue}
          onSubmit={event => event.preventDefault()}
          onKeyDown={() => undefined}
          busy={false}
          canSend
          onStop={() => undefined}
          editing={false}
          onCancelEdit={() => undefined}
          chips={null}
          retentionDays={null}
          fullscreen={false}
          commands={matchSlashCommands(value, false)}
          onCommand={command => picked.push(command)}
        />
      );
    }
    render(<Harness />);
    const field = screen.getByLabelText('Message Pip');
    fireEvent.change(field, { target: { value: '/' } });
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-activedescendant', 'squire-input-commands-0');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(picked.map(c => c.name)).toEqual(['mine']);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: '/n' } });
    fireEvent.click(screen.getByRole('option', { name: /\/new/ }));
    expect(picked.at(-1)).toMatchObject({ name: 'new' });
    expect(picked.at(-1)?.prompt).toBeUndefined();
  });
});

describe('Squire on the status bar', () => {
  let bar: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    bar = document.createElement('div');
    bar.id = 'status-bar';
    document.body.appendChild(bar);
  });
  afterEach(() => {
    vi.useRealTimers();
    bar.remove();
  });

  const renderCompanion = (notes: SquireNote[], onOpen = vi.fn()) =>
    render(
      <SquireBarCompanion
        name="Pip"
        open={false}
        onOpen={onOpen}
        launcherState="idle"
        animated={false}
        notes={notes}
      />
    );

  it('introduces himself once, without motion, and "Show me" opens the chat', async () => {
    const notes = notesFor();
    const onOpen = vi.fn();
    const first = renderCompanion(notes, onOpen);
    expect(document.querySelector('.sqbar-scroll.open')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600);
    });
    expect(screen.getByRole('status')).toHaveTextContent("Hail! I'm Pip");
    expect(document.querySelector('.sqbar-scroll.open')).not.toBeNull();
    // Motion off: the scroll fades in instead of unrolling.
    expect(document.querySelector('.sqbar-scroll.still')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('opsknight.squire.delivered')).toContain('intro');
    first.unmount();

    renderCompanion(notes);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(document.querySelector('.sqbar-scroll.open')).toBeNull();
  });

  it('delivers on-call news after the intro and rolls the scroll away on "Got it"', async () => {
    window.localStorage.setItem('opsknight.squire.delivered', JSON.stringify(['intro']));
    renderCompanion(notesFor({ shifts: [shift(90, 600)] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    expect(screen.getByRole('status')).toHaveTextContent('begins in 1h 30m');
    expect(screen.getByRole('link', { name: 'View schedule' })).toHaveAttribute(
      'href',
      '/schedules/sch_1'
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(document.querySelector('.sqbar-scroll.open')).toBeNull();
  });

  it('holds a note while it is hovered and lets it go after the pointer leaves', async () => {
    window.localStorage.setItem('opsknight.squire.delivered', JSON.stringify(['intro']));
    // A different shift than the test above: delivered notes are remembered for the page.
    renderCompanion(notesFor({ shifts: [shift(100, 600)] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    const scroll = document.querySelector('.sqbar-scroll')!;
    // React derives enter/leave from over/out.
    fireEvent.pointerOver(scroll);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(document.querySelector('.sqbar-scroll.open')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('begins in 1h 40m');
    fireEvent.pointerOut(scroll, { relatedTarget: document.body });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(document.querySelector('.sqbar-scroll.open')).toBeNull();
    // The live region stays mounted, empty between notes.
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('rests awake, dozes after two quiet minutes, and wakes on activity', async () => {
    window.localStorage.setItem('opsknight.squire.delivered', JSON.stringify(['intro']));
    renderCompanion([]);
    const stage = () => document.querySelector('.sqbar-stage')!;
    expect(stage().className).not.toContain('dozing');
    expect(stage().querySelector('svg')).toHaveAttribute('data-state', 'idle');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(125_000);
    });
    expect(stage().className).toContain('dozing');
    expect(stage().querySelector('svg')).toHaveAttribute('data-state', 'offline');
    await act(async () => {
      fireEvent.pointerMove(window);
    });
    expect(stage().className).not.toContain('dozing');
  });

  it('shows an unread dot when an answer is waiting', () => {
    render(
      <SquireBarCompanion
        name="Pip"
        open={false}
        onOpen={vi.fn()}
        launcherState="idle"
        animated={false}
        unread
      />
    );
    expect(screen.getByRole('button', { name: 'Ask Pip, an answer is ready' })).toBeInTheDocument();
    expect(document.querySelector('.sqbar-dot')).not.toBeNull();
  });
});
