import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ContributingFactorsSelector from './ContributingFactorsSelector';

describe('ContributingFactorsSelector', () => {
  it('renders selected factors in view mode', () => {
    render(
      <ContributingFactorsSelector
        selectedFactors={['INFRASTRUCTURE', 'CODE_DEFECT']}
        isEditable={false}
      />
    );

    expect(screen.getByText('Infrastructure')).toBeInTheDocument();
    expect(screen.getByText('Code Defect')).toBeInTheDocument();
  });

  it('allows clicking factors to toggle in edit mode', () => {
    const onToggle = vi.fn();
    render(
      <ContributingFactorsSelector
        selectedFactors={['INFRASTRUCTURE']}
        isEditable={true}
        onToggle={onToggle}
      />
    );

    const codeDefectButton = screen.getByRole('button', { name: /code defect/i });
    fireEvent.click(codeDefectButton);

    expect(onToggle).toHaveBeenCalledWith('CODE_DEFECT');
  });
});
