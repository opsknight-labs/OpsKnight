import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '@/components/ConfirmDialog';

function setup(isOpen = true) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      isOpen={isOpen}
      title="Delete service?"
      message="This cannot be undone."
      confirmText="Delete"
      cancelText="Keep"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('shows the title and message as an alert dialog when open', () => {
    setup();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Delete service?');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
  });

  it('cancels from the cancel button', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms without also cancelling, leaving the caller to close it', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('cancels on Escape', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    setup(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete service?')).not.toBeInTheDocument();
  });
});
