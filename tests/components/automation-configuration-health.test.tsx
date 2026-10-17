import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ConfigurationHealth } from '@/components/automation/ConfigurationHealth';

it('keeps blocking errors visible and groups warning walls behind closed disclosures', () => {
  render(
    <ConfigurationHealth
      issues={[
        { level: 'ERROR', code: 'MISSING_ROUTE', message: 'Choose a responder route' },
        ...Array.from({ length: 28 }, (_, index) => ({
          level: 'WARNING' as const,
          code: 'UNUSED_FIELD',
          message: `Field ${index} is unused`,
        })),
        { level: 'WARNING', code: 'SHADOWED_RULE', message: 'Rule is shadowed', ruleId: 'r1' },
      ]}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a responder route');
  expect(screen.getByText('1 error · 29 warnings')).toBeInTheDocument();
  expect(screen.getByText('Unused fields (28)')).toBeInTheDocument();
  expect(screen.getByText('Shadowed rules (1)')).toBeInTheDocument();
  expect(screen.getByText('Review warnings').closest('details')).not.toHaveAttribute('open');
});
