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

  it('stays visually hidden until keyboard focus reveals it', () => {
    render(<SkipLinks />);
    for (const text of ['Skip to main content', 'Skip to navigation']) {
      expect(screen.getByText(text)).toHaveClass('sr-only', 'focus:not-sr-only', 'focus:fixed');
    }
  });
});
