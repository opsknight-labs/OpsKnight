import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineNotice } from '@/components/ui/InlineNotice';

describe('InlineNotice', () => {
  it('renders with default info tone and status role', () => {
    render(<InlineNotice>Info message</InlineNotice>);
    const notice = screen.getByRole('status');
    expect(notice).toBeDefined();
    expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('Info message')).toBeDefined();
  });

  it('renders error tone with alert role and assertive urgency', () => {
    render(<InlineNotice tone="error">Error occurred</InlineNotice>);
    const notice = screen.getByRole('alert');
    expect(notice).toBeDefined();
    expect(notice.getAttribute('aria-live')).toBe('assertive');
    expect(screen.getByText('Error occurred')).toBeDefined();
  });

  it('renders all tones (success, warning, neutral, info, error) with correct classes', () => {
    const tones = ['success', 'warning', 'neutral', 'info', 'error'] as const;
    for (const tone of tones) {
      const { container } = render(<InlineNotice tone={tone}>Test {tone}</InlineNotice>);
      expect(container.firstChild).toBeDefined();
    }
  });

  it('supports role and aria-live overrides', () => {
    render(
      <InlineNotice tone="error" role="status" aria-live="polite">
        Overridden error
      </InlineNotice>
    );
    const notice = screen.getByRole('status');
    expect(notice).toBeDefined();
    expect(notice.getAttribute('aria-live')).toBe('polite');
  });

  it('renders title when provided', () => {
    render(<InlineNotice title="Important Title">Body text</InlineNotice>);
    expect(screen.getByText('Important Title')).toBeDefined();
    expect(screen.getByText('Body text')).toBeDefined();
  });

  it('handles dismiss button click', () => {
    const onDismiss = vi.fn();
    render(
      <InlineNotice onDismiss={onDismiss}>
        Dismissible notice
      </InlineNotice>
    );
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissButton);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
