import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EscalationPolicyCombobox from '@/components/service/EscalationPolicyCombobox';

describe('EscalationPolicyCombobox', () => {
  const mockPolicies = [
    {
      id: 'policy-critical',
      name: 'Critical Infrastructure Pager',
      description: 'Immediate paging to SRE on-call',
    },
    {
      id: 'policy-business',
      name: 'Business Hours Escalation',
      description: 'Notifies engineering lead 9am-5pm EST',
    },
  ];

  it('renders with placeholder when no policy is selected', () => {
    render(<EscalationPolicyCombobox policies={mockPolicies} value="" onChange={vi.fn()} />);

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('No Policy Attached (Unassigned)');
  });

  it('renders the selected policy name when value is provided', () => {
    render(
      <EscalationPolicyCombobox
        policies={mockPolicies}
        value="policy-critical"
        onChange={vi.fn()}
      />
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Critical Infrastructure Pager');
  });

  it('opens popover and shows search input and policy options on click', () => {
    render(<EscalationPolicyCombobox policies={mockPolicies} value="" onChange={vi.fn()} />);

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    expect(screen.getByPlaceholderText(/search escalation policies/i)).toBeInTheDocument();
    expect(screen.getByText('Critical Infrastructure Pager')).toBeInTheDocument();
    expect(screen.getByText('Immediate paging to SRE on-call')).toBeInTheDocument();
    expect(screen.getByText('Business Hours Escalation')).toBeInTheDocument();
    expect(screen.getByText('No Policy Attached')).toBeInTheDocument();
  });

  it('calls onChange with policy id when selecting an item', () => {
    const handleChange = vi.fn();
    render(<EscalationPolicyCombobox policies={mockPolicies} value="" onChange={handleChange} />);

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    const option = screen.getByText('Critical Infrastructure Pager');
    fireEvent.click(option);

    expect(handleChange).toHaveBeenCalledWith('policy-critical');
  });

  it('calls onChange with empty string when selecting No Policy Attached', () => {
    const handleChange = vi.fn();
    render(
      <EscalationPolicyCombobox
        policies={mockPolicies}
        value="policy-critical"
        onChange={handleChange}
      />
    );

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    const unassignedOption = screen.getByText('No Policy Attached');
    fireEvent.click(unassignedOption);

    expect(handleChange).toHaveBeenCalledWith('');
  });

  it('disables trigger button and hidden input when disabled is true', () => {
    const { container } = render(
      <div>
        <label htmlFor="escalationPolicyId">Default Escalation Policy</label>
        <EscalationPolicyCombobox
          policies={mockPolicies}
          value="policy-critical"
          onChange={vi.fn()}
          disabled={true}
        />
      </div>
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();

    const input = container.querySelector('input#escalationPolicyId') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(screen.getByLabelText('Default Escalation Policy')).toBeDisabled();
  });
});
