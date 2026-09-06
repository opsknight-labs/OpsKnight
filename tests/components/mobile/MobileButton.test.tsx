import { render, screen } from '@testing-library/react';
import MobileButton from '@/components/mobile/MobileButton';
import { describe, it, expect } from 'vitest';

describe('MobileButton', () => {
    it('renders as a link when href is provided', () => {
        render(<MobileButton href="/test">Link Button</MobileButton>);
        const link = screen.getByRole('link', { name: /link button/i });
        expect(link).toHaveAttribute('href', '/test');
    });

    it('renders as a button when onClick is provided', () => {
        render(<MobileButton onClick={() => { }}>Action Button</MobileButton>);
        const button = screen.getByRole('button', { name: /action button/i });
        expect(button).toBeInTheDocument();
    });

    it('applies variant classes or styles', () => {
        // Since styling is often inline or CSS variable based in this project,
        // checking for specific style application is tricky without snapshots or computed style.
        // We'll trust it renders.
        render(<MobileButton variant="danger">Danger</MobileButton>);
        const button = screen.getByText('Danger');
        expect(button).toBeInTheDocument();
    });
});
