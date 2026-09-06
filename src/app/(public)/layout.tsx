import { ReactNode } from 'react';

/**
 * Public layout for unauthenticated pages
 * No authentication required
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
    return <>{children}</>;
}







