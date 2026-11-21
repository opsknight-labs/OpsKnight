import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import OnDemandExplain from '@/components/intelligence/OnDemandExplain';

describe('OnDemandExplain', () => {
  it('asks nothing until clicked, then shows the phrasing and the deterministic detail', async () => {
    const load = vi.fn(async () => ({ detail: 'Step “Probe” failed.', phrasing: 'It timed out.' }));
    render(<OnDemandExplain label="Explain this failure" load={load} />);
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Explain this failure' }));
    expect(await screen.findByText('It timed out.')).toBeInTheDocument();
    expect(screen.getByText('Step “Probe” failed.')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('says so when the helper has nothing', async () => {
    render(<OnDemandExplain label="Summarise this week" load={async () => null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Summarise this week' }));
    expect(await screen.findByText('Nothing more to add right now.')).toBeInTheDocument();
  });
});
