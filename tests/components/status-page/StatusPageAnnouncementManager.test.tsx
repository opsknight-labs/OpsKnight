import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import StatusPageAnnouncementManager, {
  type AnnouncementItem,
} from '@/components/status-page/StatusPageAnnouncementManager';

const mockAnnouncements: AnnouncementItem[] = [
  {
    id: 'ann-1',
    title: 'Scheduled Database Maintenance',
    message: 'Upgrading primary replica',
    type: 'MAINTENANCE',
    startDate: '2026-09-15T14:00:00.000Z',
    endDate: '2026-09-15T16:00:00.000Z',
    isActive: true,
    affectedServiceIds: ['svc-1'],
  },
  {
    id: 'ann-2',
    title: 'API Latency Investigation',
    message: 'Investigating elevated response times',
    type: 'INCIDENT',
    startDate: '2026-09-10T10:00:00.000Z',
    endDate: null,
    isActive: true,
  },
];

const mockServices = [
  { id: 'svc-1', name: 'API Gateway', region: 'us-east-1' },
  { id: 'svc-2', name: 'Auth Service', region: 'eu-west-1' },
];

describe('StatusPageAnnouncementManager Component', () => {
  let announcements: AnnouncementItem[];
  let setAnnouncements: any;

  beforeEach(() => {
    vi.clearAllMocks();
    announcements = [...mockAnnouncements];
    setAnnouncements = vi.fn(updater => {
      if (typeof updater === 'function') {
        announcements = updater(announcements);
      } else {
        announcements = updater;
      }
    });
    global.fetch = vi.fn();
  });

  const renderManager = (
    props?: Partial<React.ComponentProps<typeof StatusPageAnnouncementManager>>
  ) => {
    return render(
      <StatusPageAnnouncementManager
        statusPageId="sp-123"
        announcements={announcements}
        setAnnouncements={setAnnouncements}
        allServices={mockServices}
        browserTimeZone="UTC"
        {...props}
      />
    );
  };

  it('renders announcement form and recent announcements list', () => {
    renderManager();

    expect(screen.getByText('Create Announcement')).toBeDefined();
    expect(screen.getByPlaceholderText(/Scheduled Database Maintenance Window/i)).toBeDefined();
    expect(screen.getByText('Recent Announcements')).toBeDefined();
    expect(screen.getByText('Scheduled Database Maintenance')).toBeDefined();
    expect(screen.getByText('API Latency Investigation')).toBeDefined();
  });

  it('supports toggling between Exact Time and All Day / Date Only', () => {
    renderManager();

    // Default is Exact Time
    const exactBtn = screen.getByRole('button', { name: /Exact Time/i });
    const allDayBtn = screen.getByRole('button', { name: /All Day \/ Date Only/i });
    expect(exactBtn).toBeDefined();
    expect(allDayBtn).toBeDefined();

    // Click All Day
    fireEvent.click(allDayBtn);
    // Time input should no longer be present
    expect(screen.queryByDisplayValue(/\d{2}:\d{2}/)).toBeNull();

    // Click Exact Time back
    fireEvent.click(exactBtn);
    expect(screen.getByText(/Set to Now/i)).toBeDefined();
  });

  it('updates end date and time via quick window buttons (+1h, +2h, +4h)', () => {
    renderManager();

    const add1hBtn = screen.getByRole('button', { name: '+1h' });
    fireEvent.click(add1hBtn);

    // Duration should calculate and show window
    expect(screen.getByText(/Window Duration:/i)).toBeDefined();
    expect(screen.getByText('1h')).toBeDefined();

    const add2hBtn = screen.getByRole('button', { name: '+2h' });
    fireEvent.click(add2hBtn);
    expect(screen.getByText(/Window Duration:/i).textContent).toContain('2h');
  });

  it('detects and displays time validation error when end time is earlier than start time', () => {
    renderManager();

    const titleInput = screen.getByPlaceholderText(/Scheduled Database Maintenance Window/i);
    const messageInput = screen.getByPlaceholderText(/Describe the scope/i);

    fireEvent.change(titleInput, { target: { value: 'Test Window' } });
    fireEvent.change(messageInput, { target: { value: 'Test Message' } });

    // Set start date to 2026-09-20 and end date to 2026-09-19
    const dateInputs = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
    fireEvent.change(dateInputs[0], { target: { value: '2026-09-20' } });

    // Add end date earlier
    const add1hBtn = screen.getByRole('button', { name: '+1h' });
    fireEvent.click(add1hBtn);

    const allDateInputs = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
    // Change end date to 2026-09-18
    fireEvent.change(allDateInputs[1], { target: { value: '2026-09-18' } });

    expect(screen.getByText(/End date and time must be after start date and time/i)).toBeDefined();

    // Submit button should be disabled
    const submitBtn = screen.getByRole('button', { name: /Add Announcement/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('successfully creates an announcement with exact ISO datetime and updates state', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        announcement: {
          id: 'ann-new',
          title: 'Emergency Patch',
          message: 'Patching OpenSSL vulnerability',
          type: 'MAINTENANCE',
          startDate: '2026-09-20T10:00:00.000Z',
          endDate: '2026-09-20T12:00:00.000Z',
          isActive: true,
        },
      }),
    });

    renderManager();

    const titleInput = screen.getByPlaceholderText(/Scheduled Database Maintenance Window/i);
    const messageInput = screen.getByPlaceholderText(/Describe the scope/i);

    fireEvent.change(titleInput, { target: { value: 'Emergency Patch' } });
    fireEvent.change(messageInput, { target: { value: 'Patching OpenSSL vulnerability' } });

    const submitBtn = screen.getByRole('button', { name: /Add Announcement/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings/status-page/announcements',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(setAnnouncements).toHaveBeenCalled();
    });
  });

  it('deletes an announcement when delete button is clicked', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    renderManager();

    const deleteButtons = screen.getAllByTitle('Delete Announcement');
    expect(deleteButtons.length).toBeGreaterThan(0);

    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings/status-page/announcements',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ statusPageId: 'sp-123', id: 'ann-1' }),
        })
      );
      expect(setAnnouncements).toHaveBeenCalled();
    });
  });
});
