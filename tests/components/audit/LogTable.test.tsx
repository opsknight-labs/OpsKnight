import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LogPagination, LogTimestamp, MonoId } from '@/components/audit/LogTable';

describe('log table kit', () => {
  it('copies the full id from a shortened monospace id and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MonoId value="evt_0123456789abcdef" display="evt_0123…" label="event ID" />);

    expect(screen.getByText('evt_0123…')).toHaveAttribute('title', 'evt_0123456789abcdef');
    fireEvent.click(screen.getByRole('button', { name: 'Copy event ID evt_0123456789abcdef' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('evt_0123456789abcdef'));
    expect(await screen.findByRole('button', { name: 'event ID copied' })).toBeInTheDocument();
  });

  it('shows relative time with the absolute time underneath', () => {
    render(<LogTimestamp date="2026-10-01T12:00:00.000Z" timeZone="UTC" />);
    const time = document.querySelector('time');
    expect(time).toHaveAttribute('dateTime', '2026-10-01T12:00:00.000Z');
    expect(time?.nextElementSibling?.textContent).toMatch(/Oct 1, 2026.*12:00/);
  });

  it('puts pagination in a labelled navigation landmark', () => {
    render(
      <LogPagination
        label="Audit log pages"
        page={2}
        pageSize={50}
        totalCount={120}
        pageHref={p => `/audit?page=${p}`}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Audit log pages' });
    expect(nav).toHaveTextContent('Page 2 of 3');
  });
});
