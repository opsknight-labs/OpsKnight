import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import TopbarNotifications from '@/components/TopbarNotifications';

type MockEventSourceInstance = {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    close: ReturnType<typeof vi.fn>;
};

const closeSpy = vi.fn().mockName('close');
const mockEventSourceCtor = vi.fn().mockImplementation(function (this: MockEventSourceInstance) {
    this.onmessage = null;
    this.onerror = null;
    this.close = closeSpy;
    return this;
}).mockName('EventSource');

vi.stubGlobal('EventSource', mockEventSourceCtor);

vi.mock('next/navigation', () => ({
    useRouter: () => ({
        push: vi.fn(),
    }),
    usePathname: () => '/',
}));

describe('TopbarNotifications', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ notifications: [], unreadCount: 0 }),
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts polling after SSE error and clears on unmount', async () => {
        const { unmount } = render(<TopbarNotifications />);
        const eventSourceInstance = mockEventSourceCtor.mock.results[0]?.value;

        act(() => {
            eventSourceInstance.onerror?.(new Event('error'));
        });

        await act(async () => {
            vi.advanceTimersByTime(30000);
        });

        const callCountAfterPolling = fetchMock.mock.calls.length;
        expect(callCountAfterPolling).toBeGreaterThan(1);

        unmount();

        await act(async () => {
            vi.advanceTimersByTime(60000);
        });

        expect(fetchMock.mock.calls.length).toBe(callCountAfterPolling);
        expect(closeSpy).toHaveBeenCalled();
    });
});
