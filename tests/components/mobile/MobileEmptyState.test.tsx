import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MobileEmptyState } from '@/components/mobile/MobileUtils';

describe('MobileEmptyState', () => {
    it('renders title, description, and action', () => {
        render(
            <MobileEmptyState
                icon="!"
                title="No data"
                description="Try again later."
                action={<button type="button">Retry</button>}
            />
        );

        expect(screen.getByText('No data')).toBeInTheDocument();
        expect(screen.getByText('Try again later.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
});
