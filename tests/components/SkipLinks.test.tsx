import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SkipLinks from '@/components/SkipLinks';

describe('SkipLinks', () => {
  it('should render skip to main content link', () => {
    render(<SkipLinks />);
    const mainLink = screen.getByText('Skip to main content');
    expect(mainLink).toBeInTheDocument();
    expect(mainLink).toHaveAttribute('href', '#main-content');
  });

  it('should render skip to navigation link', () => {
    render(<SkipLinks />);
    const navLink = screen.getByText('Skip to navigation');
    expect(navLink).toBeInTheDocument();
    expect(navLink).toHaveAttribute('href', '#navigation');
  });

  it('should have proper styling for accessibility', () => {
    render(<SkipLinks />);
    const mainLink = screen.getByText('Skip to main content');
    const styles = window.getComputedStyle(mainLink);
    expect(styles.position).toBe('absolute');
  });
});

