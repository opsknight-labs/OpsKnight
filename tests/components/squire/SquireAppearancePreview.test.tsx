import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SquireAppearancePreview from '@/components/squire/SquireAppearancePreview';

describe('assistant appearance setup', () => {
  it('previews all expressions without saving or contacting a provider, and follows appearance changes', () => {
    const { container, rerender } = render(
      <SquireAppearancePreview name="Pip" avatar="SQUIRE" animated={false} />
    );
    const picker = screen.getByRole('combobox', { name: 'Expression' });
    expect(picker.querySelectorAll('option')).toHaveLength(9);
    fireEvent.change(picker, { target: { value: 'thinking' } });
    expect(
      screen.getByText('Investigating evidence or waiting for an answer.')
    ).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('data-motion', 'off');
    rerender(<SquireAppearancePreview name="Knight" avatar="SQUIRE" animated />);
    expect(screen.getByText('Knight')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('data-state', 'thinking');
    expect(container.querySelector('svg')).toHaveAttribute('data-motion', 'on');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    rerender(<SquireAppearancePreview name="Knight" avatar="OWL" animated={false} />);
    expect(picker).toBeDisabled();
  });
});
