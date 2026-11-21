import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusUpdateAction, {
  nextUpdateLabel,
} from '@/components/incident/detail/StatusUpdateAction';

const now = Date.parse('2026-11-17T10:00:00Z');
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

describe('incident "Post status update"', () => {
  it('counts down to the next update and flags it once due', () => {
    expect(nextUpdateLabel(at(12), now)).toEqual({ text: 'Next update in 12m', overdue: false });
    expect(nextUpdateLabel(at(90), now)).toEqual({ text: 'Next update in 1h 30m', overdue: false });
    expect(nextUpdateLabel(at(0), now)).toEqual({ text: 'Update due now', overdue: true });
    expect(nextUpdateLabel(at(-120), now)).toEqual({
      text: 'Update overdue by 2h',
      overdue: true,
    });
  });

  it('renders nothing without a status page, and the action alone before the first update', () => {
    const { container, rerender } = render(<StatusUpdateAction statusUpdate={null} />);
    expect(container).toBeEmptyDOMElement();

    const href = '/settings/status-pages/page_1?announce=inc_1';
    rerender(
      <StatusUpdateAction statusUpdate={{ href, statusPageName: 'Public', nextDueAt: null }} />
    );
    expect(screen.getByRole('link', { name: /post status update/i })).toHaveAttribute('href', href);
    expect(screen.queryByText(/next update|overdue|due now/i)).toBeNull();

    rerender(
      <StatusUpdateAction
        statusUpdate={{
          href,
          statusPageName: 'Public',
          nextDueAt: new Date(Date.now() + 20 * 60_000).toISOString(),
        }}
      />
    );
    expect(screen.getByText(/^Next update in/)).toBeInTheDocument();
  });
});
