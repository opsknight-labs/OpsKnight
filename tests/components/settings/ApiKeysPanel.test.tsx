import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApiKeysPanel, { type ApiKey } from '@/components/settings/ApiKeysPanel';

// Mock server actions
vi.mock('@/app/(app)/settings/actions', () => ({
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

const mockKeys: ApiKey[] = [
  {
    id: 'key-1',
    name: 'Datadog Ingestion',
    prefix: 'ops_live_d7a',
    scopes: ['events:write', 'incidents:read'],
    createdAt: 'Sep 1, 2026',
    lastUsedAt: 'Sep 1, 2026',
    revokedAt: null,
    expiresAt: 'Nov 30, 2026',
    expired: false,
    ownerEmail: 'admin@example.com',
  },
  {
    id: 'key-2',
    name: 'GitHub CI Pipeline',
    prefix: 'ops_live_83b',
    scopes: ['incidents:write'],
    createdAt: 'Aug 15, 2026',
    lastUsedAt: null,
    revokedAt: 'Aug 20, 2026',
    expiresAt: null,
    expired: false,
    ownerEmail: 'developer@example.com',
  },
  {
    id: 'key-3',
    name: 'Old Testing Key',
    prefix: 'ops_live_12c',
    scopes: ['services:read'],
    createdAt: 'Jan 10, 2026',
    lastUsedAt: 'Jan 15, 2026',
    revokedAt: null,
    expiresAt: 'Feb 10, 2026',
    expired: true,
    ownerEmail: 'qa@example.com',
  },
];

describe('ApiKeysPanel Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all API keys with names, prefixes, scopes, and statuses', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} />);

    expect(screen.getByText('Datadog Ingestion')).toBeDefined();
    expect(screen.getByText('ops_live_d7a...')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();

    expect(screen.getByText('GitHub CI Pipeline')).toBeDefined();
    expect(screen.getByText('ops_live_83b...')).toBeDefined();
    expect(screen.getByText('Revoked')).toBeDefined();

    expect(screen.getByText('Old Testing Key')).toBeDefined();
    expect(screen.getByText('ops_live_12c...')).toBeDefined();
    expect(screen.getByText('Expired')).toBeDefined();
  });

  it('filters keys by search query', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} />);

    const searchInput = screen.getByPlaceholderText('Search by name, prefix, or owner...');
    fireEvent.change(searchInput, { target: { value: 'datadog' } });

    expect(screen.getByText('Datadog Ingestion')).toBeDefined();
    expect(screen.queryByText('GitHub CI Pipeline')).toBeNull();
    expect(screen.queryByText('Old Testing Key')).toBeNull();
  });

  it('opens create API key modal dialog on button click', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} />);

    const generateButtons = screen.getAllByRole('button', { name: /generate api key/i });
    fireEvent.click(generateButtons[0]);

    expect(screen.getByText('Generate New API Key')).toBeDefined();
    expect(screen.getByLabelText(/key name \/ client identifier \*/i)).toBeDefined();
    expect(screen.getByLabelText(/expiration duration/i)).toBeDefined();
  });

  it('renders developer API quickstart code examples', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} />);

    expect(screen.getByText('Developer API Quickstart')).toBeDefined();
    expect(screen.getByText('cURL')).toBeDefined();
    expect(screen.getByText('Node.js / Fetch')).toBeDefined();
    expect(screen.getByText('Python (requests)')).toBeDefined();
  });

  it('renders empty state when no keys exist', () => {
    render(<ApiKeysPanel keys={[]} canCreateWriteKeys={true} />);

    expect(screen.getByText('No API keys configured')).toBeDefined();
  });
});
