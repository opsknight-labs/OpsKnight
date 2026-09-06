import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock the incident creation form
const IncidentCreationForm = ({ onSubmit }: { onSubmit: (data: unknown) => void }) => {
  const [formData, setFormData] = React.useState({
    title: '',
    description: '',
    urgency: 'MEDIUM',
    serviceId: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} data-testid="incident-form">
      <input
        type="text"
        placeholder="Incident Title"
        value={formData.title}
        onChange={e => setFormData({ ...formData, title: e.target.value })}
      />
      <textarea
        placeholder="Description"
        value={formData.description}
        onChange={e => setFormData({ ...formData, description: e.target.value })}
      />
      <select
        value={formData.urgency}
        onChange={e => setFormData({ ...formData, urgency: e.target.value })}
      >
        <option value="LOW">Low</option>
        <option value="MEDIUM">Medium</option>
        <option value="HIGH">High</option>
      </select>
      <button type="submit">Create Incident</button>
    </form>
  );
};

describe('Incident Creation Flow', () => {
  let mockOnSubmit: ReturnType<typeof vi.fn<(data: unknown) => void>>;

  beforeEach(() => {
    mockOnSubmit = vi.fn<(data: unknown) => void>();
  });

  it('should render incident creation form', () => {
    render(<IncidentCreationForm onSubmit={mockOnSubmit} />);
    expect(screen.getByPlaceholderText('Incident Title')).toBeDefined();
    expect(screen.getByPlaceholderText('Description')).toBeDefined();
    expect(screen.getByText('Create Incident')).toBeDefined();
  });

  it('should update form fields on user input', () => {
    render(<IncidentCreationForm onSubmit={mockOnSubmit} />);

    const titleInput = screen.getByPlaceholderText('Incident Title') as HTMLInputElement;
    const descriptionInput = screen.getByPlaceholderText('Description') as HTMLTextAreaElement;

    fireEvent.change(titleInput, { target: { value: 'Database Outage' } });
    fireEvent.change(descriptionInput, { target: { value: 'Primary database is down' } });

    expect(titleInput.value).toBe('Database Outage');
    expect(descriptionInput.value).toBe('Primary database is down');
  });

  it('should submit form with correct data', async () => {
    render(<IncidentCreationForm onSubmit={mockOnSubmit} />);

    const titleInput = screen.getByPlaceholderText('Incident Title');
    const descriptionInput = screen.getByPlaceholderText('Description');
    const urgencySelect = screen.getByRole('combobox');
    const submitButton = screen.getByText('Create Incident');

    fireEvent.change(titleInput, { target: { value: 'API Slowdown' } });
    fireEvent.change(descriptionInput, { target: { value: 'API response time increased' } });
    fireEvent.change(urgencySelect, { target: { value: 'HIGH' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        title: 'API Slowdown',
        description: 'API response time increased',
        urgency: 'HIGH',
        serviceId: '',
      });
    });
  });

  it('should allow selecting different urgency levels', () => {
    render(<IncidentCreationForm onSubmit={mockOnSubmit} />);

    const urgencySelect = screen.getByRole('combobox') as HTMLSelectElement;

    fireEvent.change(urgencySelect, { target: { value: 'MEDIUM' } });
    expect(urgencySelect.value).toBe('MEDIUM');

    fireEvent.change(urgencySelect, { target: { value: 'LOW' } });
    expect(urgencySelect.value).toBe('LOW');
  });
});

describe('Incident Details View', () => {
  const mockIncident = {
    id: 'inc-123',
    title: 'Database Connection Issues',
    description: 'Unable to connect to primary database',
    urgency: 'HIGH',
    status: 'OPEN',
    createdAt: new Date('2024-01-01T10:00:00Z'),
  };

  const IncidentDetails = ({ incident }: { incident: typeof mockIncident }) => (
    <div data-testid="incident-details">
      <h1>{incident.title}</h1>
      <p>{incident.description}</p>
      <span data-testid="urgency">{incident.urgency}</span>
      <span data-testid="status">{incident.status}</span>
    </div>
  );

  it('should display incident details', () => {
    render(<IncidentDetails incident={mockIncident} />);

    expect(screen.getByText('Database Connection Issues')).toBeDefined();
    expect(screen.getByText('Unable to connect to primary database')).toBeDefined();
    expect(screen.getByTestId('urgency').textContent).toBe('HIGH');
    expect(screen.getByTestId('status').textContent).toBe('OPEN');
  });
});
