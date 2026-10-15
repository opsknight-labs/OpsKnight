// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import RunbookSelectorBuilder from '@/components/runbooks/RunbookSelectorBuilder';
afterEach(cleanup);
it('edits typed label fields and submits the canonical selector', () => {
  const { container } = render(
    <RunbookSelectorBuilder initialValue={{ environment: 'production' }} />
  );
  expect(screen.getByLabelText('Label 1 key')).toHaveValue('environment');
  fireEvent.change(screen.getByLabelText('Label 1 value'), { target: { value: 'staging' } });
  expect(container.querySelector('input[name="agentSelector"]')).toHaveValue(
    '{"environment":"staging"}'
  );
});
it('reports duplicate labels rather than silently discarding a row', () => {
  render(<RunbookSelectorBuilder initialValue={{ environment: 'production' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add selector label' }));
  fireEvent.change(screen.getByLabelText('Label 2 key'), { target: { value: 'environment' } });
  expect(screen.getByRole('alert')).toHaveTextContent('unique valid label keys');
});
it('preserves a valid advanced selector when returning to fields', () => {
  render(<RunbookSelectorBuilder />);
  fireEvent.click(screen.getByRole('button', { name: 'Use advanced JSON' }));
  fireEvent.change(screen.getByLabelText('Advanced selector JSON'), {
    target: { value: '{"region":"west"}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Use label fields' }));
  expect(screen.getByLabelText('Label 1 key')).toHaveValue('region');
});

it('blocks malformed JSON, duplicate JSON keys and invalid label names until corrected', () => {
  const { container } = render(<RunbookSelectorBuilder />);
  fireEvent.click(screen.getByRole('button', { name: 'Use advanced JSON' }));
  for (const value of ['{', '{"region":"one","region":"two"}', '{"bad key":"west"}']) {
    fireEvent.change(screen.getByLabelText('Advanced selector JSON'), { target: { value } });
    expect(screen.getByRole('alert')).toBeVisible();
    expect(container.querySelector('[data-form-invalid="true"]')).not.toBeNull();
  }
  fireEvent.change(screen.getByLabelText('Advanced selector JSON'), {
    target: { value: '{"region":"west"}' },
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(container.querySelector('[data-form-invalid="true"]')).toBeNull();
});
