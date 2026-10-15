// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ActionForm, SubmitButton } from '@/components/runbooks/RunbookControls';
import RunbookSelectorBuilder from '@/components/runbooks/RunbookSelectorBuilder';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));
afterEach(cleanup);
it('disables final save while invalid and enables it after correction', async () => {
  render(
    <ActionForm action={vi.fn()}>
      <RunbookSelectorBuilder />
      <SubmitButton>Save</SubmitButton>
    </ActionForm>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Use advanced JSON' }));
  fireEvent.change(screen.getByLabelText('Advanced selector JSON'), { target: { value: '{' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  fireEvent.change(screen.getByLabelText('Advanced selector JSON'), {
    target: { value: '{"region":"west"}' },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
});
