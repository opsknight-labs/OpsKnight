import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MobileListControls from '@/components/mobile/MobileListControls';

const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
    useRouter: () => ({
        replace: mockReplace,
    }),
    useSearchParams: () => mockSearchParams,
}));

describe('MobileListControls', () => {
    beforeEach(() => {
        mockReplace.mockClear();
        mockSearchParams.delete('q');
        mockSearchParams.delete('filter');
        mockSearchParams.delete('sort');
        window.localStorage.clear();
    });

    it('updates sort parameter', () => {
        render(
            <MobileListControls
                basePath="/m/incidents"
                placeholder="Search incidents..."
                filters={[{ label: 'All', value: 'all' }]}
                sortOptions={[
                    { label: 'Newest first', value: 'created_desc' },
                    { label: 'Oldest first', value: 'created_asc' },
                ]}
            />
        );

        fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'created_asc' } });
        expect(mockReplace).toHaveBeenCalledWith('/m/incidents?sort=created_asc');
    });

    it('updates filter parameter', () => {
        render(
            <MobileListControls
                basePath="/m/incidents"
                placeholder="Search incidents..."
                filters={[
                    { label: 'All', value: 'all' },
                    { label: 'Open', value: 'open' },
                ]}
                sortOptions={[
                    { label: 'Newest first', value: 'created_desc' },
                    { label: 'Oldest first', value: 'created_asc' },
                ]}
            />
        );

        fireEvent.click(screen.getByText('Open'));
        expect(mockReplace).toHaveBeenCalledWith('/m/incidents?filter=open');
    });
});
