import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ archive: vi.fn(), refresh: vi.fn() }));
vi.mock('@/app/(app)/policies/actions', () => ({ setPolicyArchived: mocks.archive }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import PolicyArchiveControl from '@/components/policies/PolicyArchiveControl';
beforeEach(() => {
  mocks.archive.mockReset().mockResolvedValue({ ok: true });
  mocks.refresh.mockReset();
});
it('keeps the server-rendered archive control disabled until its client handler is ready', async () => {
  expect(
    renderToString(<PolicyArchiveControl policyId="policy-1" archived={false} blocked={false} />)
  ).toContain('disabled=""');
  render(<PolicyArchiveControl policyId="policy-1" archived={false} blocked={false} />);
  const button = screen.getByRole('button', { name: 'Archive policy' });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(mocks.archive).toHaveBeenCalledExactlyOnceWith('policy-1', true));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
});
it('keeps current dependencies blocking archival while allowing restoration', () => {
  const view = render(<PolicyArchiveControl policyId="policy-1" archived={false} blocked />);
  expect(screen.getByRole('button', { name: 'Archive policy' })).toBeDisabled();
  view.rerender(<PolicyArchiveControl policyId="policy-1" archived blocked />);
  expect(screen.getByRole('button', { name: 'Restore policy' })).toBeEnabled();
});
