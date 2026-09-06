import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileSwipeNavigator from '@/components/mobile/MobileSwipeNavigator';

const mockPush = vi.fn();
let pathname = '/m/incidents';

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
    usePathname: () => pathname,
}));

describe('MobileSwipeNavigator', () => {
    beforeEach(() => {
        mockPush.mockClear();
        pathname = '/m/incidents';
        vi.useFakeTimers();
        vi.stubGlobal('localStorage', window.localStorage);
        window.localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const renderNavigator = (child?: React.ReactNode) =>
        render(
            <MobileSwipeNavigator>
                {child ?? <div data-testid="content">Content</div>}
            </MobileSwipeNavigator>
        );

    const swipe = (element: HTMLElement, fromX: number, fromY: number, toX: number, toY: number) => {
        const PointerEventCtor =
            typeof PointerEvent === 'undefined' ? MouseEvent : PointerEvent;
        const init = { clientX: fromX, clientY: fromY, bubbles: true } as PointerEventInit;

        element.dispatchEvent(new PointerEventCtor('pointerdown', init));
        element.dispatchEvent(new PointerEventCtor('pointermove', { ...init, clientX: toX, clientY: toY } as PointerEventInit));
        element.dispatchEvent(new PointerEventCtor('pointerup', { ...init, clientX: toX, clientY: toY } as PointerEventInit));
    };

    it('navigates to the next tab on left swipe', () => {
        const { getByTestId, container } = renderNavigator();
        const element = getByTestId('content');

        expect(container.querySelector('.mobile-route-transition')).toBeTruthy();

        swipe(element, 200, 120, 80, 126);

        vi.runAllTimers();

        expect(mockPush).toHaveBeenCalledWith('/m/services');
    });

    it('navigates to the previous tab on right swipe', () => {
        const { getByTestId } = renderNavigator();
        const element = getByTestId('content');

        swipe(element, 100, 120, 220, 118);

        vi.runAllTimers();

        expect(mockPush).toHaveBeenCalledWith('/m');
    });

    it('ignores vertical swipes', () => {
        const { getByTestId } = renderNavigator();
        const element = getByTestId('content');

        swipe(element, 120, 100, 130, 220);

        vi.runAllTimers();

        expect(mockPush).not.toHaveBeenCalled();
    });

    it('ignores swipes on the last tab', () => {
        pathname = '/m/more';
        const { getByTestId } = renderNavigator();
        const element = getByTestId('content');

        swipe(element, 200, 120, 80, 126);

        vi.runAllTimers();

        expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not swipe when starting on an interactive element', () => {
        const { getByTestId } = renderNavigator(
            <button type="button" data-testid="action-button">Tap</button>
        );
        const element = getByTestId('action-button');

        swipe(element, 200, 120, 80, 126);

        vi.runAllTimers();

        expect(mockPush).not.toHaveBeenCalled();
    });

    it('shows a swipe hint once on touch devices', () => {
        vi.stubGlobal('ontouchstart', true);
        const { container } = renderNavigator();

        expect(container.querySelector('.mobile-swipe-hint')).toBeTruthy();

        vi.runAllTimers();

        expect(window.localStorage.getItem('mobileSwipeHintSeen')).toBe('true');
    });
});
