'use client';

import { useEffect, useRef } from 'react';

type Props = {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: 'danger' | 'warning' | 'info';
};

export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
    variant = 'danger'
}: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && open) {
                onCancel();
            }
        };

        if (open) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [open, onCancel]);

    if (!open) return null;

    const variantStyles = {
        danger: {
            confirmBg: 'var(--danger)',
            confirmHover: '#b91c1c',
            icon: '!'
        },
        warning: {
            confirmBg: '#f59e0b',
            confirmHover: '#d97706',
            icon: '!'
        },
        info: {
            confirmBg: '#3b82f6',
            confirmHover: '#2563eb',
            icon: 'i'
        }
    };

    const style = variantStyles[variant];

    return (
        <div className="confirm-dialog-overlay" onClick={onCancel}>
            <div 
                ref={dialogRef}
                className="confirm-dialog"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="confirm-dialog-icon">{style.icon}</div>
                <h3 className="confirm-dialog-title">{title}</h3>
                <p className="confirm-dialog-message">{message}</p>
                <div className="confirm-dialog-actions">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="confirm-dialog-button cancel"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="confirm-dialog-button confirm"
                        style={{
                            background: style.confirmBg,
                            color: '#ffffff'
                        }}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}










