import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlackChannelToolbar } from '@/components/settings/slack/SlackChannelToolbar';

describe('SlackChannelToolbar', () => {
  const defaultProps = {
    searchQuery: '',
    onSearchChange: vi.fn(),
    filter: 'all' as const,
    onFilterChange: vi.fn(),
    summary: {
      total: 5,
      connected: 3,
      invite: 0,
      autoAdd: 2,
    },
    isLoading: false,
    isBulkConnecting: false,
    onRefresh: vi.fn(),
    onBulkConnect: vi.fn(),
    scopeHealthy: true,
  };

  it('renders search input with proper padding style to prevent icon overlap', () => {
    render(<SlackChannelToolbar {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search channels...');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveStyle({ paddingLeft: '2.5rem' });
  });

  it('calls onSearchChange when user types in search input', () => {
    const onSearchChange = vi.fn();
    render(<SlackChannelToolbar {...defaultProps} onSearchChange={onSearchChange} />);

    const searchInput = screen.getByPlaceholderText('Search channels...');
    fireEvent.change(searchInput, { target: { value: 'general' } });

    expect(onSearchChange).toHaveBeenCalledWith('general');
  });

  it('renders filter badges with summary counts', () => {
    render(<SlackChannelToolbar {...defaultProps} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
