import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { useKeyboardSafeSheetGeometry } from '@/hooks/useKeyboardSafeSheetGeometry';

type MockVisualViewport = {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  dispatch: (type: 'resize' | 'scroll') => void;
};

function mockVisualViewport(height: number, offsetTop = 0): MockVisualViewport {
  const listeners = new Map<string, Array<() => void>>();
  const viewport: MockVisualViewport = {
    height,
    offsetTop,
    addEventListener: (type, cb) => {
      const existing = listeners.get(type) ?? [];
      existing.push(cb);
      listeners.set(type, existing);
    },
    removeEventListener: (type, cb) => {
      listeners.set(type, (listeners.get(type) ?? []).filter(l => l !== cb));
    },
    dispatch: type => {
      for (const cb of listeners.get(type) ?? []) cb();
    },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  return viewport;
}

describe('useKeyboardSafeSheetGeometry', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'visualViewport');
  });

  it('returns null/0 geometry when closed', () => {
    const { result } = renderHook(() => useKeyboardSafeSheetGeometry(false));
    expect(result.current.maxHeight).toBeNull();
    expect(result.current.bottomOffset).toBe(0);
  });

  it('never floors max-height above the visible viewport', () => {
    mockVisualViewport(240);
    const { result } = renderHook(() => useKeyboardSafeSheetGeometry(true));
    expect(result.current.maxHeight).toBeLessThanOrEqual(240);
  });

  it('computes the bottom offset from the visual viewport shrinkage', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    mockVisualViewport(500, 0);
    const { result } = renderHook(() => useKeyboardSafeSheetGeometry(true));
    expect(result.current.bottomOffset).toBe(300);
  });

  it('recalculates when the viewport resizes while open', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const viewport = mockVisualViewport(800, 0);
    const { result } = renderHook(() => useKeyboardSafeSheetGeometry(true));
    expect(result.current.bottomOffset).toBe(0);

    viewport.height = 500;
    viewport.offsetTop = 20;
    act(() => viewport.dispatch('resize'));

    expect(result.current.maxHeight).toBeLessThanOrEqual(500);
    expect(result.current.bottomOffset).toBe(800 - 500 - 20);
  });
});
