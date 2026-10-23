import React, { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  NoteMarkdown,
  getSafeLinkUrl,
  getSafeImageUrl,
} from '@/components/incident/detail/NoteMarkdown';
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

  it('renders formatting toolbar buttons for bold, italic, code, link, list, and preview toggle', () => {
    render(
      <IncidentNotes incidentId="inc-100" notes={dummyNotes} canManage={true} onAddNote={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Format bold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Format italic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Format inline code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert hyperlink' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert bullet list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to Preview mode' })).toBeInTheDocument();
  });

  it('preserves draft note content when onAddNote fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failingAddNote = vi.fn().mockRejectedValue(new Error('Network error posting note'));
    render(
      <IncidentNotes
        incidentId="inc-100"
        notes={dummyNotes}
        canManage={true}
        onAddNote={failingAddNote}
      />
    );

    const textarea = screen.getByPlaceholderText(/Type a note/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Important draft text that must not be lost' } });

    const postBtn = screen.getByRole('button', { name: 'Post' });
    fireEvent.click(postBtn);

    // The draft content should be preserved even if submit fails
    expect(textarea.value).toBe('Important draft text that must not be lost');
    consoleSpy.mockRestore();
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

  it('preserves newer typing appended while note submission was in progress', async () => {
    let resolveAddNote: () => void = () => {};
    const pendingSubmission = new Promise<void>(resolve => {
      resolveAddNote = resolve;
    });

    const slowAddNote = vi.fn().mockImplementation(() => pendingSubmission);

    render(
      <IncidentNotes
        incidentId="inc-100"
        notes={dummyNotes}
        canManage={true}
        onAddNote={slowAddNote}
      />
    );

    const textarea = screen.getByPlaceholderText(/Type a note/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'First sentence.' } });

    const postBtn = screen.getByRole('button', { name: 'Post' });
    fireEvent.click(postBtn);

    // Responder types additional details while submission is still pending
    fireEvent.change(textarea, {
      target: { value: 'First sentence. Additional update typed while submitting.' },
    });

    // Submission succeeds
    await act(async () => {
      resolveAddNote();
    });

    // Only the submitted snapshot should be cleared, leaving the newly typed text
    await waitFor(() => {
      expect(textarea.value).toBe('Additional update typed while submitting.');
    });
  });
});

describe('Security: getSafeLinkUrl & getSafeImageUrl validation', () => {
  describe('getSafeLinkUrl', () => {
    it('allows valid http and https URLs', () => {
      expect(getSafeLinkUrl('https://opsknight.io/docs')).toBe('https://opsknight.io/docs');
      expect(getSafeLinkUrl('http://internal.company.net')).toBe('http://internal.company.net/');
    });

    it('allows valid root-relative paths starting with single slash', () => {
      expect(getSafeLinkUrl('/incidents/inc-123')).toBe('/incidents/inc-123');
      expect(getSafeLinkUrl('/services/auth')).toBe('/services/auth');
    });

    it('rejects protocol-relative URLs (// and /\\)', () => {
      expect(getSafeLinkUrl('//evil.com/phishing')).toBeNull();
      expect(getSafeLinkUrl('/\\evil.com/phishing')).toBeNull();
      expect(getSafeLinkUrl('\\\\evil.com\\share')).toBeNull();
    });

    it('rejects dangerous schemes such as javascript, data, blob', () => {
      expect(getSafeLinkUrl('javascript:alert(1)')).toBeNull();
      expect(getSafeLinkUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(getSafeLinkUrl('blob:https://example.com/uuid')).toBeNull();
    });
  });

  describe('getSafeImageUrl', () => {
    it('allows valid raster images with extensions .png, .jpg, .jpeg, .webp, .gif', () => {
      expect(getSafeImageUrl('/api/uploads/diagram.png')).toBe('/api/uploads/diagram.png');
      expect(getSafeImageUrl('https://cdn.example.com/photo.jpeg')).toBe(
        'https://cdn.example.com/photo.jpeg'
      );
      expect(getSafeImageUrl('https://cdn.example.com/asset.webp')).toBe(
        'https://cdn.example.com/asset.webp'
      );
    });

    it('allows safe base64 raster image data URIs', () => {
      const validPngDataUri =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      expect(getSafeImageUrl(validPngDataUri)).toBe(validPngDataUri);
    });

    it('strictly rejects SVG data URIs to prevent XSS', () => {
      expect(getSafeImageUrl('data:image/svg+xml;utf8,<svg onload=alert(1)>')).toBeNull();
      expect(
        getSafeImageUrl('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+')
      ).toBeNull();
    });

    it('rejects non-raster file extensions like .svg, .html, .js', () => {
      expect(getSafeImageUrl('/images/logo.svg')).toBeNull();
      expect(getSafeImageUrl('https://cdn.example.com/malicious.svg')).toBeNull();
      expect(getSafeImageUrl('/scripts/exploit.js')).toBeNull();
      expect(getSafeImageUrl('/pages/test.html')).toBeNull();
    });

    it('rejects protocol-relative image URLs', () => {
      expect(getSafeImageUrl('//evil.com/image.png')).toBeNull();
      expect(getSafeImageUrl('/\\evil.com/image.png')).toBeNull();
    });
  });
});
