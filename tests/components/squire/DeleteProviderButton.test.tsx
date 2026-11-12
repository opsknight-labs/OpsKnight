import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const remove = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: 'Removed' })));
vi.mock('@/app/(app)/settings/intelligence/ai/actions', () => ({
  deleteAiProviderAction: remove,
  saveAiProviderAction: vi.fn(),
  saveAiSettingsAction: vi.fn(),
  savePromptGuidanceAction: vi.fn(),
  testAiProviderAction: vi.fn(),
}));
import { DeleteProviderButton } from '@/components/settings/AiSettingsForms';

it('requires explicit confirmation before removing a provider', async () => {
  render(<DeleteProviderButton id="provider-1" name="Local provider" />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Local provider' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Local provider' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove provider' }));
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  expect((remove.mock.calls[0] as unknown as [unknown, FormData])[1].get('id')).toBe('provider-1');
});
