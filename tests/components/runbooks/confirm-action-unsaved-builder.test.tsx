import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/runbooks/RunbookModuleNav', () => ({ RunbookModuleNav: () => null }));
vi.mock('@/components/runbooks/RunbookStatusBadge', () => ({ RunbookStatusBadge: () => null }));

import { ConfirmAction } from '@/components/runbooks/RunbookControls';
import { setRunbookBuilderDirty } from '@/lib/runbooks/builder-dirty';

function renderPublish() {
  render(
    <ConfirmAction
      action={vi.fn()}
      label="Publish draft"
      variant="default"
      title="Publish immutable v2?"
      description="Only the saved draft is published."
      blockWhileBuilderDirty
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Publish draft' }));
}

describe('ConfirmAction with unsaved builder edits', () => {
  afterEach(() => act(() => setRunbookBuilderDirty(false)));

  it('lets the draft be published when the builder has nothing unsaved', async () => {
    renderPublish();

    const submit = await screen.findAllByRole('button', { name: 'Publish draft' });
    expect(submit.at(-1)).toHaveProperty('disabled', false);
    expect(screen.getByText('Only the saved draft is published.')).toBeTruthy();
  });

  it('explains and refuses publishing while the builder holds unsaved edits', async () => {
    act(() => setRunbookBuilderDirty(true));
    renderPublish();

    expect(await screen.findByText(/not saved to this draft/i)).toBeTruthy();
    const submit = screen.getAllByRole('button', { name: 'Publish draft' }).at(-1);
    expect(submit).toHaveProperty('disabled', true);
  });

  it('enables publishing again once the edits are saved', async () => {
    act(() => setRunbookBuilderDirty(true));
    renderPublish();
    await screen.findByText(/not saved to this draft/i);

    act(() => setRunbookBuilderDirty(false));

    expect(screen.queryByText(/not saved to this draft/i)).toBeNull();
  });
});
