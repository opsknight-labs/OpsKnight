// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { HealthAttentionPanel } from '@/components/runbooks/health/HealthAttentionPanel';
afterEach(cleanup);
it('does not assert fleetwide operational health without worker evidence', () => {
  render(<HealthAttentionPanel issues={[]} agentsCount={2} />);
  expect(screen.queryByText('All Systems Operational')).not.toBeInTheDocument();
  expect(screen.getByText(/Worker health is not verified/)).toBeVisible();
});
