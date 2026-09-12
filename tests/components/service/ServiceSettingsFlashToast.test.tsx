import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import ServiceSettingsFlashToast from '@/components/service/ServiceSettingsFlashToast';
import { notify } from '@/lib/toast';

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => '/services/srv-123',
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/lib/toast', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('ServiceSettingsFlashToast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('does not toast when saved param is absent', () => {
    mockSearchParams = new URLSearchParams('tab=settings');
    render(<ServiceSettingsFlashToast serviceId="srv-123" />);

    expect(notify.success).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not toast for ?error=duplicate-service', () => {
    mockSearchParams = new URLSearchParams('error=duplicate-service');
    render(<ServiceSettingsFlashToast serviceId="srv-123" />);

    expect(notify.success).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('fires exactly one success toast on saved=1 and strips query param', () => {
    mockSearchParams = new URLSearchParams('saved=1&tab=settings');
    const { rerender } = render(<ServiceSettingsFlashToast serviceId="srv-123" />);

    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(notify.success).toHaveBeenCalledWith('Service settings saved', {
      id: 'service:srv-123:save',
    });
    expect(mockReplace).toHaveBeenCalledWith('/services/srv-123?tab=settings', { scroll: false });

    // Strict-mode / re-render simulation with same params should not duplicate toast
    rerender(<ServiceSettingsFlashToast serviceId="srv-123" />);
    expect(notify.success).toHaveBeenCalledTimes(1);
  });

  it('resets guard when saved param is cleared and allows a second independent save toast', () => {
    // 1. First save
    mockSearchParams = new URLSearchParams('saved=1');
    const { rerender } = render(<ServiceSettingsFlashToast serviceId="srv-123" />);

    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(notify.success).toHaveBeenCalledWith('Service settings saved', {
      id: 'service:srv-123:save',
    });

    // 2. Query param stripped after navigation
    mockSearchParams = new URLSearchParams('');
    rerender(<ServiceSettingsFlashToast serviceId="srv-123" />);
    expect(notify.success).toHaveBeenCalledTimes(1);

    // 3. User makes a second save, redirecting back to ?saved=1
    mockSearchParams = new URLSearchParams('saved=1');
    rerender(<ServiceSettingsFlashToast serviceId="srv-123" />);

    expect(notify.success).toHaveBeenCalledTimes(2);
  });
});
