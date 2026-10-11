import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installNavigationHistoryTracking,
  registerNavigationGuard,
} from '@/lib/client-navigation-guard';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.reverse().forEach(cleanup => cleanup());
  cleanups.length = 0;
  vi.restoreAllMocks();
});

describe('draft history protection', () => {
  it.each(['back', 'forward'] as const)(
    'restores a cancelled %s transition and allows a confirmed retry',
    direction => {
      cleanups.push(installNavigationHistoryTracking());
      const first = history.state;
      history.pushState({ __NA: true, tree: 'middle' }, '', '?middle');
      const middle = history.state;
      history.pushState({ __NA: true, tree: 'last' }, '', '?last');
      const last = history.state;
      if (direction === 'forward')
        window.dispatchEvent(new PopStateEvent('popstate', { state: middle }));
      const current = direction === 'back' ? last : middle;
      const destination = direction === 'back' ? middle : last;
      const delta = direction === 'back' ? -1 : 1;
      const go = vi.spyOn(history, 'go').mockImplementation(() => undefined);
      let resume: (() => void) | undefined;
      const prompt = vi.fn((retry: () => void) => {
        resume = retry;
      });
      cleanups.push(registerNavigationGuard(prompt));
      const router = vi.fn();
      window.addEventListener('popstate', router);
      cleanups.push(() => window.removeEventListener('popstate', router));
      window.dispatchEvent(new PopStateEvent('popstate', { state: destination }));
      expect(prompt).toHaveBeenCalledOnce();
      expect(router).not.toHaveBeenCalled();
      expect(go).toHaveBeenLastCalledWith(-delta);
      window.dispatchEvent(new PopStateEvent('popstate', { state: current }));
      expect(router).not.toHaveBeenCalled();
      // Cancelling means leaving the restored entry and all draft state untouched.
      expect(prompt).toHaveBeenCalledOnce();
      resume?.();
      expect(go).toHaveBeenLastCalledWith(delta);
      window.dispatchEvent(new PopStateEvent('popstate', { state: destination }));
      expect(router).toHaveBeenCalledOnce();
      expect(prompt).toHaveBeenCalledOnce();
      expect(first).toHaveProperty('__opsknightHistoryIndex');
      expect(middle).toMatchObject({ __NA: true, tree: 'middle' });
    }
  );
});
