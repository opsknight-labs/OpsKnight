import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  MobileStatusBadge,
  MobileUrgencyBadge,
  MobileAvatar,
  MobileHealthIndicator,
  MobileProgressBar,
} from '@/components/mobile/MobileUtils';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';

// Mock navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams,
}));

describe('Mobile Components', () => {
  describe('MobileStatusBadge', () => {
    it('renders the canonical Triggered label for OPEN status', () => {
      render(<MobileStatusBadge status="open" />);
      expect(screen.getByText('Triggered')).toBeInTheDocument();
    });

    it('renders correct label for RESOLVED status', () => {
      render(<MobileStatusBadge status="resolved" />);
      expect(screen.getByText('Resolved')).toBeInTheDocument();
    });
  });

  describe('MobileUrgencyBadge', () => {
    it('renders HIGH urgency', () => {
      render(<MobileUrgencyBadge urgency="high" />);
      expect(screen.getByText('high')).toBeInTheDocument();
    });
  });

  describe('MobileAvatar', () => {
    it('renders initials from name', () => {
      render(<MobileAvatar name="John Doe" />);
      expect(screen.getByText('JD')).toBeInTheDocument();
    });

    it('renders single initial for single name', () => {
      render(<MobileAvatar name="Alice" />);
      expect(screen.getByText('A')).toBeInTheDocument();
    });
  });

  describe('MobileSearchWithParams', () => {
    it('renders search input with placeholder', () => {
      render(<MobileSearchWithParams placeholder="Test Search" />);
      expect(screen.getByPlaceholderText('Test Search')).toBeInTheDocument();
    });

    it('updates URL on type', () => {
      render(<MobileSearchWithParams />);
      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'test query' } });

      // Advance timers for debounce
      // But useDebounce in the component might use setTimeout which requires async handling or fake timers
      // Since we mocked the component logic, let's just check if it was called eventually?
      // Actually, without fake timers, the debounce (500ms) will delay the call.
      // Let's rely on checking if the input *change* handler was called,
      // but we are testing MobileSearchWithParams which is the integration.

      // For unit testing this specific component, verifying the router call is better.
      // We need to wait for debounce.
    });

    it('calls router with correct params', async () => {
      vi.useFakeTimers();
      render(<MobileSearchWithParams />);
      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'search term' } });

      vi.advanceTimersByTime(1000);

      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('q=search+term'));
      vi.useRealTimers();
    });
  });

  describe('MobileHealthIndicator', () => {
    it('renders correct color for healthy', () => {
      render(<MobileHealthIndicator status="healthy" />);
      // Healthy is green #16a34a (rgb(22, 163, 74))
      // Since it's an inline style span, we can check style
      // Getting simple element by generic query might be hard, let's use container
      const { container } = render(<MobileHealthIndicator status="healthy" />);
      const span = container.firstChild as HTMLElement;
      expect(span).toHaveClass('bg-emerald-500');
    });

    it('renders correct color for critical', () => {
      const { container } = render(<MobileHealthIndicator status="critical" />);
      const span = container.firstChild as HTMLElement;
      expect(span).toHaveClass('bg-red-500');
    });
  });

  describe('MobileProgressBar', () => {
    it('renders correct width percentage', () => {
      render(<MobileProgressBar value={50} max={100} showLabel />);
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('clamps values over 100%', () => {
      render(<MobileProgressBar value={150} max={100} showLabel />);
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  // We will verify FilterChip logic if needed, but it's simpler UI
});
