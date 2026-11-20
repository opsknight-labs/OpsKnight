import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SettingsRow, settingsRowDescribedBy } from '@/components/settings/layout/SettingsRow';

describe('SettingsSection', () => {
  it('is a section landmark named by its h2 title, with actions and footer', () => {
    render(
      <SettingsSection
        title="Password"
        description="Change how you sign in."
        action={<button type="button">Reset</button>}
        footer={<button type="submit">Save</button>}
      >
        <p>Body</p>
      </SettingsSection>
    );
    const region = screen.getByRole('region', { name: 'Password' });
    expect(screen.getByRole('heading', { level: 2, name: 'Password' })).toBeInTheDocument();
    expect(region).toHaveTextContent('Change how you sign in.');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('can sit one level down inside a tab panel', () => {
    render(
      <SettingsSection title="Danger zone" headingLevel="h3" tone="danger">
        <p>Body</p>
      </SettingsSection>
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Danger zone' })).toBeInTheDocument();
  });
});

describe('SettingsRow inline validation', () => {
  it('renders help text and an inline error the control can reference', () => {
    render(
      <SettingsRow
        label="Retention days"
        htmlFor="retention"
        description="How long to keep traces."
        error="Enter a number between 1 and 365."
        required
      >
        <input
          id="retention"
          aria-describedby={settingsRowDescribedBy('retention', { description: true, error: true })}
        />
      </SettingsRow>
    );
    const input = screen.getByRole('textbox', { name: /Retention days/ });
    expect(input).toHaveAccessibleDescription(
      'How long to keep traces. Enter a number between 1 and 365.'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number between 1 and 365.');
    expect(screen.getByText('(required)')).toBeInTheDocument();
  });
});
