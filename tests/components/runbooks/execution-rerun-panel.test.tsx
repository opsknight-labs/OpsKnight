import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewRerunAction = vi.fn(async (_executionId: string) => ({ error: 'blocked by server' }));
const executeRerunAction = vi.fn(async (_executionId: string, _data: FormData) => undefined);

vi.mock('@/app/(app)/runbooks/executions/actions', () => ({
  previewRerunAction: (id: string) => previewRerunAction(id),
  executeRerunAction: (id: string, data: FormData) => executeRerunAction(id, data),
}));

import { ExecutionRerunPanel } from '@/components/runbooks/executions/ExecutionRerunPanel';

describe('ExecutionRerunPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('previews through the re-run action before any execution', async () => {
    render(<ExecutionRerunPanel executionId="exec_1" blockedReason={null} canExecute />);
    const preview = screen.getByRole('button', { name: 'Preview re-run' });
    expect(preview).toBeEnabled();
    await act(async () => {
      fireEvent.click(preview);
    });
    expect(previewRerunAction).toHaveBeenCalledWith('exec_1');
    expect(executeRerunAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('blocked by server');
    expect(screen.queryByRole('button', { name: 'Re-run this plan' })).toBeNull();
  });

  it('shows why a re-run is unavailable and disables the preview', () => {
    render(
      <ExecutionRerunPanel
        executionId="exec_1"
        blockedReason="The service rule that started this run was detached."
        canExecute
      />
    );
    expect(screen.getByText(/was detached/)).toBeInTheDocument();
    const preview = screen.getByRole('button', { name: 'Preview re-run' });
    expect(preview).toBeDisabled();
    fireEvent.click(preview);
    expect(previewRerunAction).not.toHaveBeenCalled();
  });

  it('explains missing execute permission', () => {
    render(<ExecutionRerunPanel executionId="exec_1" blockedReason={null} canExecute={false} />);
    expect(screen.getByText(/permission to execute runbooks/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview re-run' })).toBeDisabled();
  });
});
