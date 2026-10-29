import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import ScopeSelectorGrouped, { type ScopeItem } from '@/components/settings/ScopeSelectorGrouped';
import { ALL_API_SCOPE_DEFINITIONS } from '@/lib/api-scope-registry';
import { Key } from 'lucide-react';

const mockScopes: ScopeItem[] = ALL_API_SCOPE_DEFINITIONS.filter(
  definition => definition.status === 'active'
).map(definition => ({
  value: definition.scope as string,
  title: definition.title,
  detail: definition.description,
  icon: Key,
  category: definition.category,
  write: definition.write,
}));

function ControlledWrapper({
  initialScopes = new Set<string>(['events:write', 'incidents:read']),
  isAdmin = true,
}: {
  initialScopes?: Set<string>;
  isAdmin?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(initialScopes);
  return (
    <ScopeSelectorGrouped
      availableScopes={mockScopes}
      selectedScopes={selected}
      onChange={setSelected}
      isAdmin={isAdmin}
      name="scopes"
    />
  );
}

describe('ScopeSelectorGrouped Component', () => {
  it('renders category headers, selection counters, and granular scope items', () => {
    render(<ControlledWrapper />);

    expect(screen.getByText('Granular Permission Scopes')).toBeDefined();
    expect(screen.getByText('Events Ingestion')).toBeDefined();
    expect(screen.getByText('Incidents & Triage')).toBeDefined();
    expect(screen.getByText('Services & Catalogs')).toBeDefined();
    expect(screen.getByText('Events ingestion')).toBeDefined();
    expect(screen.getByText('events:write')).toBeDefined();
  });

  it('renders hidden inputs for form serialization', () => {
    const { container } = render(
      <ControlledWrapper initialScopes={new Set(['events:write', 'incidents:read'])} />
    );

    const inputs = container.querySelectorAll('input[type="hidden"][name="scopes"]');
    expect(inputs.length).toBe(2);
    const values = Array.from(inputs).map(i => (i as HTMLInputElement).value);
    expect(values).toContain('events:write');
    expect(values).toContain('incidents:read');
  });

  it('toggles an individual scope when clicked', () => {
    render(<ControlledWrapper initialScopes={new Set(['events:write'])} />);

    const servicesReadCard = screen.getByText('Services read').closest('.group');
    expect(servicesReadCard).not.toBeNull();

    // Click to select
    fireEvent.click(servicesReadCard!);
    expect(screen.getByText(/selected: 2 of/i)).toBeDefined();

    // Click to deselect
    fireEvent.click(servicesReadCard!);
    expect(screen.getByText(/selected: 1 of/i)).toBeDefined();
  });

  it('bulk toggles all scopes in a category via Select all and Deselect all', () => {
    render(<ControlledWrapper initialScopes={new Set()} />);

    // In Incidents category, there are multiple scopes (read and write)
    const incidentsHeader = screen.getByText('Incidents & Triage').closest('div.flex-col, div.sm\\:flex-row');
    const toggleButton = incidentsHeader?.parentElement?.querySelector('button') ?? screen.getAllByRole('button', { name: /select all/i })[0];
    expect(toggleButton).toBeDefined();

    fireEvent.click(toggleButton);
    expect(screen.getByText(/2 of 2 selected/i)).toBeDefined();

    // Click again to Deselect all
    const deselectButton = screen.getAllByRole('button', { name: /deselect all/i })[0];
    fireEvent.click(deselectButton);
    expect(screen.getAllByText(/0 of 2 selected/i).length).toBeGreaterThan(0);
  });

  it('filters scopes by search query across titles, values, and categories', () => {
    render(<ControlledWrapper />);

    const searchInput = screen.getByPlaceholderText(/search permissions/i);
    fireEvent.change(searchInput, { target: { value: 'runbooks:execute' } });

    expect(screen.getByText('Runbooks execute')).toBeDefined();
    expect(screen.queryByText('Events ingestion')).toBeNull();

    // Clear search using the X button
    const clearBtn = screen.getByRole('button', { name: /clear search/i });
    fireEvent.click(clearBtn);

    expect(screen.getByText('Events ingestion')).toBeDefined();
  });

  it('filters scopes by Read, Write, and Selected tabs', () => {
    render(<ControlledWrapper initialScopes={new Set(['events:write'])} />);

    // Read tab
    fireEvent.click(screen.getByRole('button', { name: /^read \(/i }));
    expect(screen.queryByText('Events ingestion')).toBeNull();
    expect(screen.getByText('Incidents read')).toBeDefined();

    // Write tab
    fireEvent.click(screen.getByRole('button', { name: /^write \(/i }));
    expect(screen.getByText('Events ingestion')).toBeDefined();
    expect(screen.queryByText('Incidents read')).toBeNull();

    // Selected tab
    fireEvent.click(screen.getByRole('button', { name: /^selected \(/i }));
    expect(screen.getByText('Events ingestion')).toBeDefined();
    expect(screen.queryByText('Incidents read')).toBeNull();
  });

  it('applies presets correctly and updates security posture', () => {
    render(<ControlledWrapper initialScopes={new Set()} isAdmin={true} />);

    // No access initially
    expect(screen.getByText('No Access')).toBeDefined();

    // Ingest Only preset
    fireEvent.click(screen.getByRole('button', { name: 'Ingest Only' }));
    expect(screen.getByText(/selected: 2 of/i)).toBeDefined();
    expect(screen.getByText('Read & Write Access')).toBeDefined();

    // Read-Only preset
    fireEvent.click(screen.getByRole('button', { name: 'Read-Only' }));
    expect(screen.getByText('Read-Only Access')).toBeDefined();

    // Admin Full preset
    fireEvent.click(screen.getByRole('button', { name: 'Admin Full' }));
    expect(screen.getByText('Administrator Access')).toBeDefined();

    // Clear preset
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No Access')).toBeDefined();
  });

  it('hides Admin Full preset for non-admin users', () => {
    render(<ControlledWrapper isAdmin={false} />);
    expect(screen.queryByRole('button', { name: 'Admin Full' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Responder' })).toBeDefined();
  });
});
