'use client';

import { ReactNode } from 'react';

interface EmptyStateProps {
    title: string;
    description?: string;
    icon?: ReactNode;
    action?: ReactNode;
    image?: ReactNode;
    className?: string;
}

export default function EmptyState({ 
    title, 
    description, 
    icon, 
    action,
    image,
    className = '' 
}: EmptyStateProps) {
    return (
        <div className={`analytics-empty-state ui-empty-state ${className}`} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--spacing-12)',
            textAlign: 'center',
            minHeight: '300px',
        }}>
            {image && (
                <div style={{ marginBottom: 'var(--spacing-6)' }}>
                    {image}
                </div>
            )}
            {icon && !image && (
                <div className="analytics-empty-icon" style={{
                    width: '64px',
                    height: '64px',
                    marginBottom: 'var(--spacing-4)',
                    opacity: 0.4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2.5rem',
                }}>
                    {icon}
                </div>
            )}
            <h3 className="analytics-empty-title" style={{
                fontSize: 'var(--font-size-xl)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: description ? 'var(--spacing-2)' : 'var(--spacing-4)',
            }}>
                {title}
            </h3>
            {description && (
                <p className="analytics-empty-description" style={{
                    fontSize: 'var(--font-size-base)',
                    color: 'var(--text-muted)',
                    maxWidth: '400px',
                    marginBottom: action ? 'var(--spacing-6)' : 0,
                }}>
                    {description}
                </p>
            )}
            {action && (
                <div style={{ marginTop: 'var(--spacing-4)' }}>
                    {action}
                </div>
            )}
        </div>
    );
}

