import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import RuleWizard from '@/components/runbooks/RuleWizard';
afterEach(cleanup);
it('keeps entered fields mounted across steps and hides premature save controls', () => {
  const { container } = render(
    <form>
      <RuleWizard
        steps={[
          { title: 'Version', content: <input aria-label="Rule name" name="name" /> },
          { title: 'Review', content: <button type="submit">Save rule</button> },
        ]}
      />
    </form>
  );
  fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Diagnostic' } });
  expect(screen.queryByRole('button', { name: 'Save rule' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
  expect(screen.getByRole('button', { name: 'Save rule' })).toBeVisible();
  expect(new FormData(container.querySelector('form')!).get('name')).toBe('Diagnostic');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText('Rule name')).toHaveValue('Diagnostic');
});

it('shows ordinary validated inputs and masks secret, sensitive and unclassified fields in review', () => {
  render(
    <form>
      <RuleWizard
        steps={[
          {
            title: 'Inputs',
            content: (
              <>
                <input
                  name="input:region"
                  aria-label="Region"
                  data-review-sensitive="false"
                  defaultValue="eu-west-1"
                />
                <input
                  name="input:secret"
                  data-review-sensitive="true"
                  defaultValue="vault-credential"
                />
                <input name="input:legacy" defaultValue="unclassified-value" />
                <input
                  name="input:password"
                  type="password"
                  data-review-sensitive="false"
                  defaultValue="hidden-password"
                />
              </>
            ),
          },
          { title: 'Review', content: <button type="submit">Save rule</button> },
        ]}
      />
    </form>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
  const review = screen.getByLabelText('Rule configuration review');
  expect(review).toHaveTextContent('eu-west-1');
  expect(review).not.toHaveTextContent('vault-credential');
  expect(review).not.toHaveTextContent('unclassified-value');
  expect(review).not.toHaveTextContent('hidden-password');
});
