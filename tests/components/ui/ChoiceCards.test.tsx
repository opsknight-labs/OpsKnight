import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ChoiceCards from '@/components/ui/ChoiceCards';

const choices = [
  { value: 'OFF', title: 'Off', body: 'Nothing changes.' },
  { value: 'SHADOW', title: 'Watch only', body: 'Records only.' },
  { value: 'ON', title: 'On', body: 'Applies it.', disabled: true },
] as const;

describe('ChoiceCards', () => {
  it('is a labelled radio group that starts on the first choice and submits with a form', () => {
    const { container } = render(
      <form>
        <ChoiceCards name="mode" legend="Mode" choices={choices} />
      </form>
    );
    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument();
    expect(new FormData(container.querySelector('form') as HTMLFormElement).get('mode')).toBe(
      'OFF'
    );
    fireEvent.click(screen.getByRole('radio', { name: /^Watch only/ }));
    expect(new FormData(container.querySelector('form') as HTMLFormElement).get('mode')).toBe(
      'SHADOW'
    );
  });

  it('starts on defaultValue and reports changes', () => {
    const onChange = vi.fn();
    render(
      <ChoiceCards
        name="m"
        legend="Mode"
        choices={choices}
        defaultValue="SHADOW"
        onChange={onChange}
      />
    );
    expect(screen.getByRole('radio', { name: /^Watch only/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /^Off/ }));
    expect(onChange).toHaveBeenCalledWith('OFF');
  });

  it('follows a controlled value, and cannot pick a disabled choice', () => {
    const { rerender } = render(
      <ChoiceCards name="m" legend="Mode" choices={choices} value="OFF" />
    );
    rerender(<ChoiceCards name="m" legend="Mode" choices={choices} value="SHADOW" />);
    expect(screen.getByRole('radio', { name: /^Watch only/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^On/ })).toBeDisabled();
  });
});
