'use client';

import type { CSSProperties, FormEvent } from 'react';

type Props = {
    action: (formData: FormData) => void;
    label?: string;
    style?: CSSProperties;
    className?: string;
    confirmText?: string;
    disabled?: boolean;
    title?: string;
};

export default function DeleteUserButton({
    action,
    label = 'Delete',
    style,
    className,
    confirmText = 'Delete this user? This will remove memberships, shifts, notes, notifications, watchers, and unassign incidents.',
    disabled = false,
    title
}: Props) {
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        if (disabled) {
            event.preventDefault();
            return;
        }

        if (!window.confirm(confirmText)) {
            event.preventDefault();
        }
    };

    return (
        <form action={action} onSubmit={handleSubmit}>
            <button
                type="submit"
                className={`delete-user-button ${className ?? ''}`.trim()}
                style={style}
                disabled={disabled}
                title={title}
            >
                {label}
            </button>
        </form>
    );
}
