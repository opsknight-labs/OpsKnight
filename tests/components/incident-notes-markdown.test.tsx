import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteMarkdown } from '@/components/incident/detail/NoteMarkdown';
import NoteCard from '@/components/incident/NoteCard';
import IncidentNotes from '@/components/incident/detail/IncidentNotes';

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({
    userTimeZone: 'UTC',
  }),
}));

describe('NoteMarkdown & Inline Markdown Parser', () => {
  it('renders **bold text** as strong elements', () => {
    const { container } = render(<NoteMarkdown content="This is **bold message** in note" />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('bold message');
  });

  it('renders *italic text* as em elements', () => {
    const { container } = render(<NoteMarkdown content="This is *italicized details* here" />);
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe('italicized details');
  });

  it('renders `inline code` as code elements', () => {
    const { container } = render(<NoteMarkdown content="Check error in `server.ts:45`" />);
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('server.ts:45');
  });

  it('renders hyperlinks safely with target=_blank and rel=noopener', () => {
    const { container } = render(
      <NoteMarkdown content="Refer to [Dashboard Docs](https://opsknight.io/docs)" />
    );
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('Dashboard Docs');
    expect(link?.getAttribute('href')).toBe('https://opsknight.io/docs');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders image markdown with img element and preview options', () => {
    const { container } = render(
      <NoteMarkdown content="Graph below: ![CPU Spike](/api/uploads/123-cpu.png)" />
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/api/uploads/123-cpu.png');
    expect(img?.getAttribute('alt')).toBe('CPU Spike');
    expect(screen.getByText('Zoom')).toBeInTheDocument();
  });

  it('renders file attachments as styled attachment pills', () => {
    const { container } = render(
      <NoteMarkdown content="Logs attached: [📎 crash-dump.log (1.2 MB)](/api/uploads/dump.log)" />
    );
    const attachment = container.querySelector('a');
    expect(attachment).not.toBeNull();
    expect(attachment?.textContent).toContain('📎 crash-dump.log (1.2 MB)');
    expect(attachment?.getAttribute('href')).toBe('/api/uploads/dump.log');
  });

  it('renders multi-line code blocks with copy action', () => {
    const content = '```json\n{\n  "service": "api",\n  "error": "OOM"\n}\n```';
    render(<NoteMarkdown content={content} />);
    expect(screen.getByText('json')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText(/"service": "api"/)).toBeInTheDocument();
  });
});

describe('NoteCard integration with rich markdown', () => {
  it('renders bold and links accurately inside NoteCard', () => {
    const now = new Date('2026-10-23T10:00:00Z');
    const { container } = render(
      <NoteCard
        content="Incident escalated to **Tier 2**. Check [War Room](https://opsknight.io/room)"
        userName="Responder Alice"
        createdAt={now}
      />
    );

    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('Tier 2');

    const link = container.querySelector('a');
    expect(link?.textContent).toBe('War Room');
    expect(link?.getAttribute('href')).toBe('https://opsknight.io/room');
  });
});

describe('IncidentNotes composer toolbar & live preview', () => {
  const dummyNotes = [
    {
      id: 'note-1',
      content: 'Initial note with **bold info**',
      user: { name: 'Admin', email: 'admin@opsknight.io' },
      createdAt: new Date(),
    },
  ];

  it('renders formatting toolbar buttons for bold, italic, code, link, picture, and file', () => {
    render(
      <IncidentNotes incidentId="inc-100" notes={dummyNotes} canManage={true} onAddNote={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Format bold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Format italic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Format inline code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert hyperlink' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert bullet list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload picture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload file attachment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to Preview mode' })).toBeInTheDocument();
  });

  it('applies bold formatting when bold button is clicked', () => {
    render(
      <IncidentNotes incidentId="inc-100" notes={dummyNotes} canManage={true} onAddNote={vi.fn()} />
    );

    const boldBtn = screen.getByRole('button', { name: 'Format bold' });
    fireEvent.click(boldBtn);

    const textarea = screen.getByPlaceholderText(/Type a note/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain('**bold text**');
  });

  it('toggles live markdown preview mode', () => {
    render(
      <IncidentNotes incidentId="inc-100" notes={dummyNotes} canManage={true} onAddNote={vi.fn()} />
    );

    const textarea = screen.getByPlaceholderText(/Type a note/i);
    fireEvent.change(textarea, { target: { value: 'Testing **preview mode** now' } });

    // Click Preview button
    const previewBtn = screen.getByRole('button', { name: 'Switch to Preview mode' });
    fireEvent.click(previewBtn);

    // Live preview should render <strong>preview mode</strong>
    expect(screen.getByText('preview mode').tagName).toBe('STRONG');

    // Switch back to Write mode
    const writeBtn = screen.getByRole('button', { name: 'Switch to Write mode' });
    fireEvent.click(writeBtn);
    expect(screen.getByPlaceholderText(/Type a note/i)).toBeInTheDocument();
  });
});
