import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MobileNotificationsClient from '@/components/mobile/MobileNotificationsClient';

const mockFetch = vi.fn();

describe('MobileNotificationsClient', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders notifications from the API', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                notifications: [
                    {
                        id: 'n-1',
                        title: 'API Down',
                        message: 'Payments service is down.',
                        time: '2m ago',
                        unread: true,
                        type: 'incident',
                        incidentId: 'inc-1',
                        createdAt: new Date().toISOString()
                    }
                ],
                unreadCount: 1,
                total: 1
            })
        });

        render(<MobileNotificationsClient />);

        expect(await screen.findByText('API Down')).toBeInTheDocument();
        expect(screen.getByText('Payments service is down.')).toBeInTheDocument();
        expect(screen.getByText('Today')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    });

    it('marks all notifications as read', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    notifications: [
                        {
                            id: 'n-1',
                            title: 'API Down',
                            message: 'Payments service is down.',
                            time: '2m ago',
                            unread: true,
                            type: 'incident',
                            incidentId: 'inc-1',
                            createdAt: new Date().toISOString()
                        }
                    ],
                    unreadCount: 1,
                    total: 1
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true })
            });

        render(<MobileNotificationsClient />);
        await screen.findByText('API Down');

        fireEvent.click(screen.getByText('Mark all read'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith('/api/notifications', expect.objectContaining({
                method: 'PATCH'
            }));
        });
    });

    it('filters to unread notifications', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    notifications: [],
                    unreadCount: 0,
                    total: 0
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    notifications: [],
                    unreadCount: 0,
                    total: 0
                })
            });

        render(<MobileNotificationsClient />);
        await screen.findByText('Notifications');

        fireEvent.click(screen.getByText('Unread'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenLastCalledWith('/api/notifications?unreadOnly=true');
        });
    });

    it('shows skeletons while loading', () => {
        mockFetch.mockImplementation(() => new Promise(() => {}));

        render(<MobileNotificationsClient />);

        expect(screen.getByTestId('notifications-skeleton')).toBeInTheDocument();
    });
});
