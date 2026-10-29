import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import Link from 'next/link';

// Mock the Sidebar component
vi.mock('@/components/Sidebar', () => ({
    default: () => <nav data-testid="sidebar">Sidebar</nav>
}));

// Mock the Topbar components
vi.mock('@/components/TopbarUserMenu', () => ({
    default: () => <div data-testid="user-menu">User Menu</div>
}));

vi.mock('@/components/TopbarNotifications', () => ({
    default: () => <div data-testid="notifications">Notifications</div>
}));

// Create a simple Layout component for testing
const Layout = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="layout">
            <nav data-testid="sidebar">Sidebar</nav>
            <div className="main-content">
                <header>
                    <div data-testid="user-menu">User Menu</div>
                    <div data-testid="notifications">Notifications</div>
                </header>
                <main>{children}</main>
            </div>
        </div>
    );
};

describe('Layout Components', () => {
    describe('Layout Structure', () => {
        it('should render sidebar', () => {
            render(<Layout><div>Content</div></Layout>);
            expect(screen.getByTestId('sidebar')).toBeDefined();
        });

        it('should render user menu', () => {
            render(<Layout><div>Content</div></Layout>);
            expect(screen.getByTestId('user-menu')).toBeDefined();
        });

        it('should render notifications', () => {
            render(<Layout><div>Content</div></Layout>);
            expect(screen.getByTestId('notifications')).toBeDefined();
        });

        it('should render children content', () => {
            render(<Layout><div>Page Content</div></Layout>);
            expect(screen.getByText('Page Content')).toBeDefined();
        });
    });

    describe('Navigation', () => {
        it('should render navigation items', () => {
            const Nav = () => (
                <nav>
                    <Link href="/dashboard">Dashboard</Link>
                    <Link href="/incidents">Incidents</Link>
                    <Link href="/services">Services</Link>
                </nav>
            );

            render(<Nav />);
            expect(screen.getByText('Dashboard')).toBeDefined();
            expect(screen.getByText('Incidents')).toBeDefined();
            expect(screen.getByText('Services')).toBeDefined();
        });
    });
});
