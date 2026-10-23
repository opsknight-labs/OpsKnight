import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NativeSelect } from '@/components/automation/authoring/primitives';

describe('NativeSelect', () => {
  it('renders a genuine accessible native select element with forwarded ref', () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <NativeSelect ref={ref} aria-label="Environment select" defaultValue="prod">
        <option value="dev">Development</option>
        <option value="prod">Production</option>
      </NativeSelect>
    );

    const select = screen.getByRole('combobox', { name: 'Environment select' });
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(ref.current).toBe(select);
    expect(select).toHaveValue('prod');
  });

  it('associates with an external label via htmlFor and id', () => {
    render(
      <div>
        <label htmlFor="cluster-choice">Cluster</label>
        <NativeSelect id="cluster-choice" defaultValue="us-east">
          <option value="us-east">US East</option>
          <option value="eu-west">EU West</option>
        </NativeSelect>
      </div>
    );

    const select = screen.getByLabelText('Cluster');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('us-east');
  });

  it('dispatches standard native change events when selection changes without synthetic fabrication', () => {
    const onChange = vi.fn();
    render(
      <NativeSelect aria-label="Priority" onChange={onChange} defaultValue="P2">
        <option value="P1">P1 - Critical</option>
        <option value="P2">P2 - High</option>
        <option value="P3">P3 - Low</option>
      </NativeSelect>
    );

    const select = screen.getByRole('combobox', { name: 'Priority' });
    fireEvent.change(select, { target: { value: 'P1' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(select).toHaveValue('P1');
  });

  it('supports optgroups and disabled states natively', () => {
    render(
      <NativeSelect aria-label="Grouped select" disabled>
        <optgroup label="Cloud Providers">
          <option value="aws">AWS</option>
          <option value="gcp">GCP</option>
        </optgroup>
      </NativeSelect>
    );

    const select = screen.getByRole('combobox', { name: 'Grouped select' });
    expect(select).toBeDisabled();
    expect(select.querySelector('optgroup[label="Cloud Providers"]')).toBeInTheDocument();
  });
});
