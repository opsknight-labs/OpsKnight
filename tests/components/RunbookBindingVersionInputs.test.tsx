// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RunbookBindingVersionInputs from '@/components/service/RunbookBindingVersionInputs';
vi.mock('@/components/runbooks/RunbookControls', () => ({
  FormSelect: ({
    name,
    label,
    value,
    disabled,
    options,
    onValueChange,
  }: {
    name: string;
    label: string;
    value: string;
    disabled?: boolean;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
  }) => (
    <select
      name={name}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={event => onValueChange(event.target.value)}
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(cleanup);
it('confirms the exact published pin before enabling automatic mode', () => {
  render(
    <RunbookBindingVersionInputs
      versions={[{ id: 'version-1', version: 1, state: 'PUBLISHED', inputs: [] }]}
      publishedVersionId="version-1"
      initialStrategy="LATEST_PUBLISHED"
      initialVersionId={null}
      initialMode="MANUAL"
      values={{}}
    />
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Execution mode' }), {
    target: { value: 'AUTOMATIC' },
  });
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Pin published version v1');
  expect(screen.getByRole('combobox', { name: 'Execution mode', hidden: true })).toHaveValue(
    'MANUAL'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pin version and select Automatic' }));
  expect(screen.getByRole('combobox', { name: 'Execution mode' })).toHaveValue('AUTOMATIC');
  expect(screen.getByRole('combobox', { name: 'Version strategy' })).toHaveValue('PINNED');
  expect(screen.getByRole('combobox', { name: 'Version strategy' })).toBeDisabled();
});
it('keeps manual mode when the pin confirmation is cancelled', () => {
  render(
    <RunbookBindingVersionInputs
      versions={[{ id: 'version-1', version: 1, state: 'PUBLISHED', inputs: [] }]}
      publishedVersionId="version-1"
      initialStrategy="LATEST_PUBLISHED"
      initialVersionId={null}
      initialMode="MANUAL"
      values={{}}
    />
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Execution mode' }), {
    target: { value: 'AUTOMATIC' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Keep current mode' }));
  expect(screen.getByRole('combobox', { name: 'Execution mode' })).toHaveValue('MANUAL');
});

it('resolves fields and the submitted version from the exact pinned selection', () => {
  const changed = vi.fn();
  const { container } = render(
    <RunbookBindingVersionInputs
      versions={[
        {
          id: 'old',
          version: 1,
          state: 'PUBLISHED',
          inputs: [
            {
              key: 'legacy',
              label: 'Legacy input',
              type: 'STRING',
              required: true,
              defaultValue: null,
              description: '',
            },
          ],
        },
        {
          id: 'new',
          version: 2,
          state: 'PUBLISHED',
          inputs: [
            {
              key: 'replacement',
              label: 'Replacement input',
              type: 'STRING',
              required: true,
              defaultValue: null,
              description: '',
            },
          ],
        },
      ]}
      publishedVersionId="new"
      initialStrategy="LATEST_PUBLISHED"
      initialVersionId={null}
      values={{}}
      onVersionChange={changed}
    />
  );
  expect(screen.getByLabelText('Replacement input *')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Version strategy' }), {
    target: { value: 'PINNED' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Pinned version' }), {
    target: { value: 'old' },
  });
  expect(screen.getByLabelText('Legacy input *')).toBeVisible();
  expect(screen.queryByLabelText('Replacement input *')).toBeNull();
  expect(container.querySelector('input[name="expectedVersionId"]')).toHaveValue('old');
  expect(changed).toHaveBeenLastCalledWith('old');
});
