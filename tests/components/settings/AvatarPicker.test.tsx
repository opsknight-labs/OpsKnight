import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AvatarPicker } from '@/components/settings/AvatarPicker';

function setup(onSelect: (url: string) => Promise<boolean | void> | boolean | void) {
  const onOpenChange = vi.fn();
  render(
    <AvatarPicker
      open
      onOpenChange={onOpenChange}
      onSelect={onSelect}
      userName="System Admin"
      currentAvatarUrl="/avatars/avatar-animal-2.png"
    />
  );
  return onOpenChange;
}

describe('AvatarPicker', () => {
  it('marks the saved avatar as current and offers every category', () => {
    setup(vi.fn());
    expect(screen.getByRole('button', { name: 'Clever Cat (current)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    for (const name of [
      'Squire',
      'OpsKnight',
      'Team',
      'Illustrated',
      'Sketch',
      'Cartoon',
      'Robots',
      'Pixel',
      'Emoji',
      'Orbs',
      'Initials',
    ]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('offers the Squire and the OpsKnight knights', () => {
    const onSelect = vi.fn().mockResolvedValue(true);
    setup(onSelect);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Squire' }));
    for (const name of ['Squire', 'Paladin', 'Midnight', 'Ember']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Paladin' }));
    expect(onSelect).toHaveBeenCalledWith('/avatars/squire/paladin.svg');
  });

  it('offers the OpsKnight knights', () => {
    const onSelect = vi.fn().mockResolvedValue(true);
    setup(onSelect);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'OpsKnight' }));
    for (const name of ['Sentinel', 'Direwolf', 'Warden', 'Kingsguard']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Sentinel' }));
    expect(onSelect).toHaveBeenCalledWith('/avatars/knight/sentinel.svg');
  });

  it('saves the pick and closes once it is saved', async () => {
    const onSelect = vi.fn().mockResolvedValue(true);
    const onOpenChange = setup(onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'Night Owl' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('/avatars/avatar-animal-1.png'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('stays open when the save fails, so another can be tried', async () => {
    const onSelect = vi.fn().mockResolvedValue(false);
    const onOpenChange = setup(onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'Night Owl' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Night Owl' })).toBeEnabled());
  });

  it('does not start a second save while one is in flight', async () => {
    let finish: (value: boolean) => void = () => {};
    const onSelect = vi.fn(() => new Promise<boolean>(resolve => (finish = resolve)));
    setup(onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'Night Owl' }));
    fireEvent.click(screen.getByRole('button', { name: 'Swift Fox' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    finish(true);
  });
});
