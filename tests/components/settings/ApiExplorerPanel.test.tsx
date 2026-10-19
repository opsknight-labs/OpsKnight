import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApiExplorerPanel, {
  getCurlSnippet,
  getJsSnippet,
  getPythonSnippet,
  type ApiEndpointDoc,
} from '@/components/settings/ApiExplorerPanel';

const mockEndpoints: ApiEndpointDoc[] = [
  {
    method: 'GET',
    path: '/incidents',
    tag: 'Incidents',
    summary: 'List incidents with filtering and cursor pagination',
    description: 'Retrieve paginated incidents with team boundary checks.',
    scope: 'incidents:read',
    parameters: [
      {
        name: 'status',
        in: 'query',
        required: false,
        description: 'Filter by incident status',
      },
    ],
  },
  {
    method: 'POST',
    path: '/incidents',
    tag: 'Incidents',
    summary: 'Create incident',
    description: 'Trigger a new incident and run escalation policies.',
    scope: 'incidents:write',
    requestBody: {
      description: 'Incident payload',
      sample: {
        title: 'API Gateway 502 Errors',
        serviceId: 'svc_api',
        priority: 'P1',
      },
    },
  },
  {
    method: 'DELETE',
    path: '/services/{id}',
    tag: 'Services',
    summary: 'Delete service boundary',
    description: 'Remove service definition and dependencies.',
    scope: 'services:write',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Unique service identifier',
      },
    ],
  },
];

describe('ApiExplorerPanel Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders endpoint items with HTTP method, path, tag, and scope badge', () => {
    render(
      <ApiExplorerPanel endpoints={mockEndpoints} appUrl="https://api.test.opsknight.local" />
    );

    expect(screen.getAllByText('/api/v2/incidents').length).toBe(2);
    expect(screen.getByText('/api/v2/services/{id}')).toBeDefined();
    expect(screen.getByText('incidents:read')).toBeDefined();
    expect(screen.getByText('services:write')).toBeDefined();
    expect(screen.getByText(/List incidents with filtering/i)).toBeDefined();
  });

  it('filters endpoints by search query', () => {
    render(
      <ApiExplorerPanel endpoints={mockEndpoints} appUrl="https://api.test.opsknight.local" />
    );

    const searchInput = screen.getByPlaceholderText(/search endpoints by path or keyword/i);
    fireEvent.change(searchInput, { target: { value: 'DELETE' } });

    expect(screen.getByText('/api/v2/services/{id}')).toBeDefined();
    expect(screen.queryByText('/api/v2/incidents')).toBeNull();
  });

  it('expands an endpoint to view parameters and request tabs', () => {
    render(
      <ApiExplorerPanel endpoints={mockEndpoints} appUrl="https://api.test.opsknight.local" />
    );

    const deleteCard = screen.getByText('/api/v2/services/{id}');
    fireEvent.click(deleteCard);

    expect(screen.getByText('Remove service definition and dependencies.')).toBeDefined();
    expect(screen.getByText('Unique service identifier')).toBeDefined();
    expect(screen.getByText('cURL')).toBeDefined();
    expect(screen.getByText('JavaScript')).toBeDefined();
    expect(screen.getByText('Python')).toBeDefined();
  });

  it('generates HTTP 204 safe response handling in JavaScript and Python snippets for DELETE endpoints', () => {
    render(
      <ApiExplorerPanel endpoints={mockEndpoints} appUrl="https://api.test.opsknight.local" />
    );

    // Expand the DELETE endpoint
    const deleteCard = screen.getByText('/api/v2/services/{id}');
    fireEvent.click(deleteCard);

    // Switch to JavaScript tab using pointerdown/click
    const jsTab = screen.getByRole('tab', { name: /javascript/i });
    fireEvent.pointerDown(jsTab, { button: 0, ctrlKey: false });
    fireEvent.click(jsTab);

    // Also try keydown Enter / Space if still inactive
    if (jsTab.getAttribute('data-state') !== 'active') {
      fireEvent.keyDown(jsTab, { key: 'Enter', code: 'Enter' });
    }
    if (jsTab.getAttribute('data-state') !== 'active') {
      fireEvent.keyDown(jsTab, { key: ' ', code: 'Space' });
    }

    const jsPanel = document.querySelector('[id$="-content-node"]');
    expect(jsPanel).not.toBeNull();
    expect(jsPanel?.textContent).toContain('if (response.status === 204)');
    expect(jsPanel?.textContent).toContain('Success (204 No Content)');

    // Switch to Python tab
    const pyTab = screen.getByRole('tab', { name: /python/i });
    fireEvent.pointerDown(pyTab, { button: 0, ctrlKey: false });
    fireEvent.click(pyTab);
    if (pyTab.getAttribute('data-state') !== 'active') {
      fireEvent.keyDown(pyTab, { key: 'Enter', code: 'Enter' });
    }
    if (pyTab.getAttribute('data-state') !== 'active') {
      fireEvent.keyDown(pyTab, { key: ' ', code: 'Space' });
    }

    const pyPanel = document.querySelector('[id$="-content-python"]');
    expect(pyPanel).not.toBeNull();
    expect(pyPanel?.textContent).toContain('if response.status_code == 204:');
    expect(pyPanel?.textContent).toContain('Success (204 No Content)');
  });

  it('supports expand all and collapse all toggles', () => {
    render(
      <ApiExplorerPanel endpoints={mockEndpoints} appUrl="https://api.test.opsknight.local" />
    );

    const expandAllButton = screen.getByRole('button', { name: /expand all/i });
    fireEvent.click(expandAllButton);

    expect(
      screen.getByText('Retrieve paginated incidents with team boundary checks.')
    ).toBeDefined();
    expect(screen.getByText('Trigger a new incident and run escalation policies.')).toBeDefined();
    expect(screen.getByText('Remove service definition and dependencies.')).toBeDefined();

    const collapseAllButton = screen.getByRole('button', { name: /collapse all/i });
    fireEvent.click(collapseAllButton);

    expect(
      screen.queryByText('Retrieve paginated incidents with team boundary checks.')
    ).toBeNull();
  });

  it('toggles authentication header format between Bearer and X-API-Key', () => {
    const { container } = render(
      <ApiExplorerPanel endpoints={mockEndpoints} appUrl="https://api.test.opsknight.local" />
    );

    // Expand GET /incidents (first matching endpoint)
    const getIncidents = screen.getAllByText('/api/v2/incidents')[0];
    fireEvent.click(getIncidents);

    expect(container.textContent).toContain('Authorization: Bearer ok_live_your_api_key');

    // Click on X-API-Key header button
    const xApiKeyButton = screen.getByRole('button', { name: 'X-API-Key' });
    fireEvent.click(xApiKeyButton);

    expect(container.textContent).toContain('X-API-Key: ok_live_your_api_key');
  });

  it('resolves parameterized path templates to realistic sample IDs in code snippets', () => {
    const { container } = render(
      <ApiExplorerPanel endpoints={mockEndpoints} appUrl="https://api.test.opsknight.local" />
    );

    // Expand DELETE /services/{id}
    const deleteCard = screen.getByText('/api/v2/services/{id}');
    fireEvent.click(deleteCard);

    // Should resolve {id} to srv_123456 instead of raw {id}
    expect(container.textContent).toContain(
      'https://api.test.opsknight.local/api/v2/services/srv_123456'
    );
  });

  it('renders gracefully without crashing when endpoints array is empty', () => {
    render(<ApiExplorerPanel endpoints={[]} appUrl="https://api.test.opsknight.local" />);

    expect(screen.getByText(/Showing/i)).toBeDefined();
    expect(screen.getByText(/No matching REST endpoints found/i)).toBeDefined();
  });
});

describe('required preconditions in code examples', () => {
  const draft: ApiEndpointDoc = {
    method: 'PATCH',
    path: '/runbooks/{id}/drafts/{versionId}',
    tag: 'Runbooks',
    summary: 'Edit draft',
    description: '',
    parameters: [
      { name: 'If-Match', in: 'header', required: true },
      { name: 'Idempotency-Key', in: 'header', required: true },
    ],
    requestBody: { sample: { definition: { steps: [] } } },
  };
  it('includes required revision and retry headers in all three languages', () => {
    for (const snippet of [getCurlSnippet(draft), getJsSnippet(draft), getPythonSnippet(draft)]) {
      expect(snippet).toContain('If-Match');
      expect(snippet).toContain('"3"');
      expect(snippet).toContain('Idempotency-Key');
      expect(snippet).toContain('cmv7kbd0l000dxlzuo1cmhu1e');
      expect(snippet).toContain('cmv7kbd0l000exlzuo1cmhu1e');
      expect(snippet).not.toContain('{versionId}');
    }
    expect(getCurlSnippet(draft)).not.toContain('\\n');
  });
});
