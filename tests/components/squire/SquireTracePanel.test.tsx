import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/squire/SquireMarkdown', () => ({
  default: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));

import SquireMessage from '@/components/squire/SquireMessage';
import { parseTrace, type Turn } from '@/components/squire/chat-types';
import type { SquireTrace } from '@/lib/intelligence/squire/contract';

const trace: SquireTrace = {
  mode: 'ai',
  tools: ['Reading the incident', 'Checking recent changes'],
  sources: ['Checkout pool exhausted'],
  model: 'claude-sonnet',
  provider: 'Anthropic',
  tokens: { input: 12_400, output: 310, cacheRead: 11_000 },
  durationMs: 4_250,
  verified: true,
};

const props = {
  index: 1,
  name: 'Pip',
  busy: false,
  last: true,
  animated: false,
  onOutcome: () => undefined,
  onRetry: () => undefined,
  onEdit: () => undefined,
};

describe('How I got this', () => {
  it('is a collapsed disclosure that opens to what the answer read and which model wrote it', () => {
    const turn: Turn = { role: 'assistant', content: 'The pool is exhausted.', mode: 'ai', trace };
    const { container } = render(<SquireMessage {...props} turn={turn} />);
    const panel = container.querySelector('[data-testid="squire-trace"]')!;
    expect(panel.tagName).toBe('DETAILS');
    expect(panel).not.toHaveAttribute('open');
    const summary = screen.getByText('How I got this');
    expect(summary.tagName).toBe('SUMMARY');
    fireEvent.click(summary);
    expect(panel).toHaveAttribute('open');
    expect(screen.getByText('Reading the incident · Checking recent changes')).toBeInTheDocument();
    expect(screen.getByText('Checkout pool exhausted')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet (Anthropic)')).toBeInTheDocument();
    expect(screen.getByText('12,400 in · 310 out · 11,000 from cache')).toBeInTheDocument();
    expect(screen.getByText('4.3 s')).toBeInTheDocument();
    expect(screen.getByText('Yes, every record read is kept as evidence')).toBeInTheDocument();
  });

  it('shows a basic answer without model or tokens, and nothing while still streaming', () => {
    const basic: SquireTrace = {
      mode: 'basic',
      tools: [],
      sources: [],
      durationMs: 120,
      verified: false,
    };
    const turn: Turn = { role: 'assistant', content: 'Two incidents are open.', trace: basic };
    const { rerender } = render(<SquireMessage {...props} turn={turn} />);
    expect(screen.getByText('Basic (no AI)')).toBeInTheDocument();
    expect(screen.getByText('Nothing')).toBeInTheDocument();
    expect(screen.getByText('None cited')).toBeInTheDocument();
    expect(screen.queryByText('Model')).not.toBeInTheDocument();
    expect(screen.queryByText('Tokens')).not.toBeInTheDocument();
    rerender(<SquireMessage {...props} busy turn={turn} />);
    expect(screen.queryByText('How I got this')).not.toBeInTheDocument();
  });

  it('accepts a well-formed streamed or saved trace and drops a malformed one', () => {
    expect(parseTrace(trace)).toEqual(trace);
    expect(parseTrace({ ...trace, prompt: 'leak' })).toBeUndefined();
    expect(parseTrace({ ...trace, durationMs: -1 })).toBeUndefined();
    expect(parseTrace(null)).toBeUndefined();
  });
});
