'use client';

import { logger } from '@/lib/logger';
import { useState } from 'react';

type CopyButtonProps = {
  text: string;
  className?: string; // Add className prop
};

export default function CopyButton({ text, className }: CopyButtonProps) {
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
      onClick={handleCopy}
      className={className} // Apply className
      style={{
        padding: '0.5rem 0.75rem',
        background: copied ? 'var(--success)' : 'var(--primary-color)',
        color: 'white',
        border: 'none',
        borderRadius: '0px',
        cursor: 'pointer',
        fontSize: '0.75rem',
        fontWeight: '500',
        whiteSpace: 'nowrap',
        transition: 'background 0.2s',
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}
