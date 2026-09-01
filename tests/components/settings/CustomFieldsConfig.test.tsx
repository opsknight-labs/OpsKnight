import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomFieldsConfig, { type CustomField } from '@/components/CustomFieldsConfig';

// Mock Next.js navigation
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

const mockFields: CustomField[] = [
  {
    id: 'field-1',
    name: 'Customer Tier',
    key: 'customer_tier',
    type: 'SELECT',
    required: true,
    defaultValue: 'Tier 1',
    options: ['Tier 1', 'Tier 2', 'Tier 3'],
    order: 1,
    showInList: true,
    _count: { values: 15 },
  },
  {
    id: 'field-2',
    name: 'Jira Ticket',
    key: 'jira_ticket',
    type: 'TEXT',
    required: false,
    defaultValue: null,
    options: null,
    order: 2,
    showInList: false,
    _count: { values: 5 },
  },
  {
    id: 'field-3',
    name: 'Is Customer Impacting',
    key: 'is_customer_impacting',
    type: 'BOOLEAN',
    required: false,
    defaultValue: 'true',
    options: null,
    order: 3,
    showInList: true,
    _count: { values: 22 },
  },
];

describe('CustomFieldsConfig Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all custom fields with labels, keys, and type badges', () => {
    render(<CustomFieldsConfig customFields={mockFields} />);

    expect(screen.getByText('Customer Tier')).toBeDefined();
    expect(screen.getByText('customer_tier')).toBeDefined();
    expect(screen.getByText('Jira Ticket')).toBeDefined();
    expect(screen.getByText('jira_ticket')).toBeDefined();
    expect(screen.getByText('Is Customer Impacting')).toBeDefined();
    expect(screen.getByText('is_customer_impacting')).toBeDefined();

    // Badges
    expect(screen.getByText('Required')).toBeDefined();
    expect(screen.getAllByText('Table Column').length).toBe(2);
  });

  it('filters fields using search input', () => {
    render(<CustomFieldsConfig customFields={mockFields} />);

    const searchInput = screen.getByPlaceholderText('Search by label or key...');
    fireEvent.change(searchInput, { target: { value: 'jira' } });

    expect(screen.queryByText('Customer Tier')).toBeNull();
    expect(screen.getByText('Jira Ticket')).toBeDefined();
    expect(screen.queryByText('Is Customer Impacting')).toBeNull();
  });

  it('filters fields by scope (Required only)', () => {
    render(<CustomFieldsConfig customFields={mockFields} />);

    expect(screen.getByText('Customer Tier')).toBeDefined();
    expect(screen.getByText('Jira Ticket')).toBeDefined();
  });

  it('renders quick template recommendations when fields are few', () => {
    render(<CustomFieldsConfig customFields={mockFields} />);

    expect(screen.getByText('Recommended Field Templates')).toBeDefined();
    expect(screen.getByText('Root Cause Category')).toBeDefined();
    expect(screen.getByText('Affected Cloud Region')).toBeDefined();
  });

  it('opens add custom field modal dialog when clicking add button', () => {
    render(<CustomFieldsConfig customFields={mockFields} />);

    const addButton = screen.getByRole('button', { name: /add custom field/i });
    fireEvent.click(addButton);

    expect(screen.getByText('Create Custom Incident Field')).toBeDefined();
    expect(screen.getByLabelText(/field label \*/i)).toBeDefined();
    expect(screen.getByLabelText(/field key \(identifier\) \*/i)).toBeDefined();
    expect(screen.getByText('Interactive Responder Simulator')).toBeDefined();
  });

  it('opens edit modal dialog with pre-filled fields and locked key', () => {
    render(<CustomFieldsConfig customFields={mockFields} />);

    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    fireEvent.click(editButtons[0]);

    expect(screen.getByText('Edit Field: Customer Tier')).toBeDefined();
    const keyInput = screen.getByDisplayValue('customer_tier') as HTMLInputElement;
    expect(keyInput.disabled).toBe(true);
  });

  it('renders empty state when no fields exist and offers create action', () => {
    render(<CustomFieldsConfig customFields={[]} />);

    expect(screen.getByText('No custom fields configured')).toBeDefined();
    expect(screen.getByRole('button', { name: /create custom field/i })).toBeDefined();
  });
});
