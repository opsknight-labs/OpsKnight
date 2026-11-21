import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SquireSavedAction from '@/components/squire/SquireSavedAction';
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
afterEach(() => vi.unstubAllGlobals());
it('recovers a saved outcome using only a read, without a confirmation control', async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { outcome: { message: 'Note added.' } } }),
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <SquireSavedAction
      action={{
        receiptId: '37c680f0-124a-4530-841a-a6110f79f7c6',
        action: 'add_note',
        title: 'Add note',
        incidentId: 'incident-a',
      }}
    />
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check result' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Note added.');
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    '/api/intelligence/squire/actions/37c680f0-124a-4530-841a-a6110f79f7c6',
    { cache: 'no-store' }
  );
});
