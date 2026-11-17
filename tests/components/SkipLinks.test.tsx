import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SkipLinks from '@/components/SkipLinks';

describe('SkipLinks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should render skip to main content link', () => {
    render(<SkipLinks />);
    const mainLink = screen.getByText('Skip to main content');
    expect(mainLink).toHaveAttribute('href', '#main-content');
  });

  it('should render skip to navigation link', () => {
    render(<SkipLinks />);
    const navLink = screen.getByText('Skip to navigation');
    expect(navLink).toHaveAttribute('href', '#navigation');
  });

  it('is visually hidden until focused and themed with semantic tokens', () => {
    render(<SkipLinks />);
    const mainLink = screen.getByText('Skip to main content');
    expect(mainLink).toHaveClass('sr-only', 'focus:not-sr-only', 'focus:bg-primary');
    expect(mainLink).not.toHaveAttribute('style');
  });

  it('moves focus to the main content when activated', () => {
    const main = document.createElement('main');
    main.id = 'main-content';
    document.body.appendChild(main);
    render(<SkipLinks />);

    fireEvent.click(screen.getByText('Skip to main content'));
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(main);
  });
});
