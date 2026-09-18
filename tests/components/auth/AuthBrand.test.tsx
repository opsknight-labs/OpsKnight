import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AuthBrand from '@/components/auth/AuthBrand';

describe('AuthBrand', () => {
  it('renders the brand logo and name linking to OpsKnight website', () => {
    render(<AuthBrand />);

    const link = screen.getByRole('link', { name: /opsknight/i });
    expect(link).toHaveAttribute('href', 'https://opsknight.com/');

    const img = screen.getByRole('img', { name: /opsknight/i });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toBe('/logo.png');
  });

  it('applies compact styling when compact is true', () => {
    render(<AuthBrand compact />);
    expect(screen.getByText('OpsKnight')).toHaveClass('text-base');
  });
});
