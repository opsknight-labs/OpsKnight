import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RoleMappingEditor, { type RoleMappingRule } from '@/components/settings/RoleMappingEditor';

describe('RoleMappingEditor', () => {
  const sampleMappings: RoleMappingRule[] = [
    { claim: 'groups', value: 'e4da804f-0e4c-4eed-9ecf-d5924af4d67e', role: 'ADMIN' },
  ];

  it('renders correctly without overlapping words in the column headers', () => {
    render(<RoleMappingEditor initialMappings={sampleMappings} onChange={vi.fn()} />);

    expect(screen.getAllByText('IdP Claim Key').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Expected Value').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Assigned Role').length).toBeGreaterThan(0);

    // Verify the inputs and selected values are present
    expect(screen.getByDisplayValue('groups')).toBeInTheDocument();
    expect(screen.getByDisplayValue('e4da804f-0e4c-4eed-9ecf-d5924af4d67e')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('ADMIN');
  });

  it('allows adding and removing rules', () => {
    const onChange = vi.fn();
    render(<RoleMappingEditor initialMappings={sampleMappings} onChange={onChange} />);

    // Add a rule
    const addRuleBtn = screen.getByRole('button', { name: /add rule/i });
    fireEvent.click(addRuleBtn);

    expect(screen.getAllByPlaceholderText(/e\.g\. groups or role/i)).toHaveLength(2);

    // Remove the first rule
    const removeBtn = screen.getByRole('button', { name: /remove rule 1/i });
    fireEvent.click(removeBtn);

    expect(screen.getAllByPlaceholderText(/e\.g\. groups or role/i)).toHaveLength(1);
  });
});
