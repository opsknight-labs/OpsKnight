'use client';

import { logger } from '@/lib/logger';
import { useState } from 'react';

type Props = {
    text: string;
    label?: string;
    className?: string;
};

export default function CopyButton({ text, label = 'Copy', className = '' }: Props) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            if (err instanceof Error) {
                logger.error('Failed to copy', { error: err.message });
            } else {
                logger.error('Failed to copy', { error: String(err) });
            }
        }
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            className={`copy-button ${className}`}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
        >
            {copied ? (
                <>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Copied!</span>
                </>
            ) : (
                <>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M5.5 3.5H11.5C12.3284 3.5 13 4.17157 13 5V11.5C13 12.3284 12.3284 13 11.5 13H5.5C4.67157 13 4 12.3284 4 11.5V5C4 4.17157 4.67157 3.5 5.5 3.5Z" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M2.5 6.5H1.5C0.671573 6.5 0 7.17157 0 8V12.5C0 13.3284 0.671573 14 1.5 14H6C6.82843 14 7.5 13.3284 7.5 12.5V11.5" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <span>{label}</span>
                </>
            )}
        </button>
    );
}










