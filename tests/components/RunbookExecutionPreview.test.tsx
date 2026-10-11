import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RunbookExecutionPreview from '@/components/runbooks/RunbookExecutionPreview';
import type { ExecutionPreview } from '@/lib/runbooks/execution-preview';

vi.mock('@/components/runbooks/RunbookControls', () => ({
  ActionForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  SubmitButton: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
    <button disabled={disabled}>{children}</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('disables an expired preview and allows a newly issued preview to execute', async () => {
  vi.useFakeTimers();
  const preview: ExecutionPreview = {
    digest: 'a'.repeat(64),
    authorizationToken: 'b'.repeat(64),
    versionId: 'version',
    version: 1,
    checksum: 'c'.repeat(64),
    agentId: null,
    agentPoolId: null,
    timeoutSeconds: 600,
    inputs: {},
    steps: [],
  };
  const previewAction = vi.fn(async () => ({
    preview: { ...preview, expiresAt: new Date(Date.now() + 300000).toISOString() },
  }));
  const { container } = render(
    <RunbookExecutionPreview previewAction={previewAction} executeAction={async () => {}} />
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Preview execution' }));
  });
  expect(
    (screen.getByRole('button', { name: 'Execute this plan' }) as HTMLButtonElement).disabled
  ).toBe(false);
  expect(
    (container.querySelector('input[name="previewAuthorizationToken"]') as HTMLInputElement).value
  ).toBe(preview.authorizationToken);
  act(() => {
    vi.advanceTimersByTime(300001);
  });
  expect(screen.getByRole('alert').textContent).toContain('This preview expired');
  expect(
    (screen.getByRole('button', { name: 'Execute this plan' }) as HTMLButtonElement).disabled
  ).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Preview execution' }));
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Execute this plan' }) as HTMLButtonElement).disabled
  ).toBe(false);
});
