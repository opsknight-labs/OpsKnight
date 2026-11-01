import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import McpPolicyScopeSelector from '@/components/settings/mcp/McpPolicyScopeSelector';
import McpClientScopeSelector from '@/components/settings/mcp/McpClientScopeSelector';

afterEach(() => {
  cleanup();
});

describe('McpPolicyScopeSelector', () => {
  const scopeChoices = [
    'incidents:read',
    'alerts:read',
    'services:read',
    'incidents:act',
    'runbooks:act',
  ];
  const initialSelected = ['incidents:read', 'alerts:read'];

  it('renders scopes, categories and live counters', () => {
    render(
      <McpPolicyScopeSelector
        scopeChoices={scopeChoices}
        selectedScopes={initialSelected}
        describeScope={scope => `Describe ${scope}`}
      />
    );

    // Global counter: 2 of 5 selected
    expect(screen.getByText('2 of 5 selected')).toBeInTheDocument();
    // Read category counter: 2 of 3 selected
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
    // Action category counter: 0 of 2 selected
    expect(screen.getByText('0 of 2 selected')).toBeInTheDocument();

    // Check individual inputs
    const incidentsRead = screen.getByDisplayValue('incidents:read') as HTMLInputElement;
    const alertsRead = screen.getByDisplayValue('alerts:read') as HTMLInputElement;
    const servicesRead = screen.getByDisplayValue('services:read') as HTMLInputElement;
    const incidentsAct = screen.getByDisplayValue('incidents:act') as HTMLInputElement;

    expect(incidentsRead.checked).toBe(true);
    expect(alertsRead.checked).toBe(true);
    expect(servicesRead.checked).toBe(false);
    expect(incidentsAct.checked).toBe(false);
  });

  it('handles global Select All and Uncheck All buttons', () => {
    render(
      <McpPolicyScopeSelector
        scopeChoices={scopeChoices}
        selectedScopes={initialSelected}
        describeScope={scope => `Describe ${scope}`}
      />
    );

    // Click global "Select all" button (first "Select all" button)
    const selectAllBtns = screen.getAllByRole('button', { name: 'Select all' });
    fireEvent.click(selectAllBtns[0]!);

    expect(screen.getByText('5 of 5 selected')).toBeInTheDocument();
    // All individual scope checkboxes should now be checked
    for (const val of scopeChoices) {
      expect((screen.getByDisplayValue(val) as HTMLInputElement).checked).toBe(true);
    }

    // Click global "Uncheck all" button
    const uncheckAllBtns = screen.getAllByRole('button', { name: 'Uncheck all' });
    fireEvent.click(uncheckAllBtns[0]!);

    expect(screen.getByText('0 of 5 selected')).toBeInTheDocument();
    for (const val of scopeChoices) {
      expect((screen.getByDisplayValue(val) as HTMLInputElement).checked).toBe(false);
    }
  });

  it('handles category-level Select All and Uncheck All', () => {
    render(
      <McpPolicyScopeSelector
        scopeChoices={scopeChoices}
        selectedScopes={initialSelected}
        describeScope={scope => `Describe ${scope}`}
      />
    );

    // Find the category "Select all" / "Uncheck all" buttons
    const selectAllButtons = screen.getAllByRole('button', { name: 'Select all' });
    // First is global, second is Read category, third is Action category
    const actionSelectAllBtn = selectAllButtons[2]!;
    fireEvent.click(actionSelectAllBtn);

    expect((screen.getByDisplayValue('incidents:act') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByDisplayValue('runbooks:act') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();

    // Now uncheck the Read category
    const uncheckAllButtons = screen.getAllByRole('button', { name: 'Uncheck all' });
    const readUncheckAllBtn = uncheckAllButtons[1]!;
    fireEvent.click(readUncheckAllBtn);

    expect((screen.getByDisplayValue('incidents:read') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByDisplayValue('alerts:read') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
  });

  it('toggles individual scope checkboxes directly', () => {
    render(
      <McpPolicyScopeSelector
        scopeChoices={scopeChoices}
        selectedScopes={initialSelected}
        describeScope={scope => `Describe ${scope}`}
      />
    );

    const servicesRead = screen.getByDisplayValue('services:read') as HTMLInputElement;
    expect(servicesRead.checked).toBe(false);

    fireEvent.click(servicesRead);
    expect(servicesRead.checked).toBe(true);
    expect(screen.getByText('3 of 5 selected')).toBeInTheDocument();

    fireEvent.click(servicesRead);
    expect(servicesRead.checked).toBe(false);
    expect(screen.getByText('2 of 5 selected')).toBeInTheDocument();
  });
});

describe('McpClientScopeSelector', () => {
  const scopeChoices = ['incidents:read', 'alerts:read', 'services:read', 'incidents:act'];
  const defaultScopes = ['incidents:read'];

  it('renders default scopes and allows Select All / Uncheck All', () => {
    render(
      <McpClientScopeSelector
        scopeChoices={scopeChoices}
        defaultScopes={defaultScopes}
        describeScope={scope => `Describe ${scope}`}
      />
    );

    expect(screen.getByText('1 of 4 selected')).toBeInTheDocument();
    expect((screen.getByDisplayValue('incidents:read') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByDisplayValue('alerts:read') as HTMLInputElement).checked).toBe(false);

    // Click Select All
    const selectAllBtn = screen.getByRole('button', { name: 'Select all' });
    fireEvent.click(selectAllBtn);

    expect(screen.getByText('4 of 4 selected')).toBeInTheDocument();
    for (const val of scopeChoices) {
      expect((screen.getByDisplayValue(val) as HTMLInputElement).checked).toBe(true);
    }

    // Click Uncheck All
    const uncheckAllBtn = screen.getByRole('button', { name: 'Uncheck all' });
    fireEvent.click(uncheckAllBtn);

    expect(screen.getByText('0 of 4 selected')).toBeInTheDocument();
    for (const val of scopeChoices) {
      expect((screen.getByDisplayValue(val) as HTMLInputElement).checked).toBe(false);
    }
  });
});
