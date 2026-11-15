import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/app/(app)/settings/intelligence/ai/routing-actions', () => ({
  saveAiRoutingAction: vi.fn(),
}));
import AiRoutingForm from '@/components/settings/AiRoutingForm';

const props = {
  investigationEnabled: false,
  providers: [{ id: 'p1', name: 'Anthropic', model: 'claude-opus-5-5', enabled: true }],
  revision: 3,
  canManage: true,
};

it('shows each capability as default tier or custom route', () => {
  render(
    <AiRoutingForm
      {...props}
      spendControlsEnabled
      routing={{ DIAGNOSE: { providerId: 'p1', model: 'claude-sonnet-5-5' } }}
    />
  );
  expect(screen.getByTestId('route-source-CLASSIFY')).toHaveTextContent(
    "Default: each provider's small model"
  );
  expect(screen.getByTestId('route-source-POSTMORTEM')).toHaveTextContent(
    "Default: each provider's strong model"
  );
  expect(screen.getByTestId('route-source-DIAGNOSE')).toHaveTextContent('Custom route');
});

it('falls back to the priority order wording while spend controls are off', () => {
  render(<AiRoutingForm {...props} routing={{}} />);
  expect(screen.getByTestId('route-source-CLASSIFY')).toHaveTextContent('Default: priority order');
});
