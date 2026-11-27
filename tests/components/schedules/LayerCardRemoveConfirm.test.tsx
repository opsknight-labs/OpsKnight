import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import LayerCard from '@/components/LayerCard';

const layer = {
  id: 'layer-1',
  name: 'Primary',
  start: new Date('2026-11-01T00:00:00.000Z'),
  end: null,
  rotationLengthHours: 24,
  priority: 0,
  restrictions: null,
  users: [
    { userId: 'u-ann', position: 0, user: { name: 'Ann' } },
    { userId: 'u-ben', position: 1, user: { name: 'Ben' } },
  ],
};

function card(previewLayerUserRemoval: (layerId: string, userId: string) => Promise<unknown>) {
  const removeLayerUser = vi.fn(async () => undefined);
  const noop = vi.fn(async () => undefined);
  render(
    <LayerCard
      layer={layer}
      scheduleId="sched-1"
      timeZone="UTC"
      users={[]}
      canManageSchedules
      updateLayer={noop}
      deleteLayer={noop}
      addLayerUser={noop}
      moveLayerUser={noop}
      removeLayerUser={removeLayerUser}
      previewLayerUserRemoval={
        previewLayerUserRemoval as ComponentProps<typeof LayerCard>['previewLayerUserRemoval']
      }
      moveLayerPrecedence={noop}
      layerPosition={0}
      layerCount={1}
    />
  );
  return { removeLayerUser };
}

describe('LayerCard removing a responder', () => {
  it('shows who is on call instead and waits for confirmation', async () => {
    const preview = vi.fn(async () => ({
      changed: true,
      message: 'Platform: Ann becomes Ben',
    }));
    const { removeLayerUser } = card(preview);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Ben from Primary' }));
    expect(await screen.findByText('Platform: Ann becomes Ben')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith('layer-1', 'u-ben');
    expect(removeLayerUser).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove responder' }));
    await waitFor(() => expect(removeLayerUser).toHaveBeenCalledWith('layer-1', 'u-ben'));
  });

  it('cancelling the confirmation leaves the responder in place', async () => {
    const { removeLayerUser } = card(async () => ({ changed: true, message: 'shifts move' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ben from Primary' }));
    await screen.findByText('shifts move');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('shifts move')).toBeNull());
    expect(removeLayerUser).not.toHaveBeenCalled();
  });

  it('removes straight away when no shift changes owner', async () => {
    const { removeLayerUser } = card(async () => ({ changed: false, message: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ben from Primary' }));
    await waitFor(() => expect(removeLayerUser).toHaveBeenCalledWith('layer-1', 'u-ben'));
    expect(screen.queryByRole('button', { name: 'Remove responder' })).toBeNull();
  });
});
