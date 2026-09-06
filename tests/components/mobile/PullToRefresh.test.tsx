import { render, fireEvent, act } from '@testing-library/react';
import PullToRefresh from '@/components/mobile/PullToRefresh';
import { useRouter } from 'next/navigation';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
    useRouter: vi.fn(),
}));

describe('PullToRefresh', () => {
    let refreshMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        refreshMock = vi.fn();
        (useRouter as any).mockReturnValue({ refresh: refreshMock });
    });

    it('triggers refresh when pulled down sufficiently at top', () => {
        const { container } = render(
            <PullToRefresh>
                <div>Test Content</div>
            </PullToRefresh>
        );

        const ptrDiv = container.firstChild as HTMLElement;

        // Mock closest() to return a mock element with scrollTop = 0
        // We mock it on the ptrDiv instance.
        // jsdom supports closest, but we want to control the return value's scrollTop
        const mockScrollParent = { scrollTop: 0 };
        ptrDiv.closest = vi.fn().mockReturnValue(mockScrollParent);

        // 1. Touch Start
        fireEvent.touchStart(ptrDiv, {
            targetTouches: [{ clientY: 100 }]
        });

        // 2. Touch Move (Down by 200px)
        fireEvent.touchMove(ptrDiv, {
            targetTouches: [{ clientY: 300 }]
        });

        // 3. Touch End
        fireEvent.touchEnd(ptrDiv);

        expect(refreshMock).toHaveBeenCalled();
    });

    it('does NOT refresh if scrolled down', () => {
        const { container } = render(
            <PullToRefresh>
                <div>Test Content</div>
            </PullToRefresh>
        );

        const ptrDiv = container.firstChild as HTMLElement;

        // Mock scrollTop > 0
        const mockScrollParent = { scrollTop: 50 };
        ptrDiv.closest = vi.fn().mockReturnValue(mockScrollParent);

        fireEvent.touchStart(ptrDiv, {
            targetTouches: [{ clientY: 100 }]
        });

        fireEvent.touchMove(ptrDiv, {
            targetTouches: [{ clientY: 300 }]
        });

        fireEvent.touchEnd(ptrDiv);

        expect(refreshMock).not.toHaveBeenCalled();
    });
});
