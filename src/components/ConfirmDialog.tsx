'use client';

import { useEffect, useRef } from 'react';
import { trapFocus } from '@/lib/focus-trap';

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      if (dialogRef.current) {
        const cleanup = trapFocus(dialogRef.current, onCancel);
        return () => {
          document.body.style.overflow = '';
          cleanup();
        };
      }
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      confirmBg: 'linear-gradient(180deg, #be123c 0%, #9f1239 100%)',
      confirmHover: '#881337',
      borderColor: '#fecaca',
      iconBg: '#fef2f2',
      iconColor: '#be123c',
    },
    warning: {
      confirmBg: 'linear-gradient(180deg, #d97706 0%, #b45309 100%)',
      confirmHover: '#92400e',
      borderColor: '#fde68a',
      iconBg: '#fffbeb',
      iconColor: '#d97706',
    },
    info: {
      confirmBg: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
      confirmHover: '#1d4ed8',
      borderColor: '#dbeafe',
      iconBg: '#dbeafe',
      iconColor: '#3b82f6',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        className="bg-card text-card-foreground"
        style={{
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          maxWidth: '500px',
          width: '100%',
          padding: '2rem',
          border: `2px solid ${styles.borderColor}`,
          position: 'relative',
          animation: 'fadeIn 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
      >
        <style>{`
                    @keyframes fadeIn {
                        from {
                            opacity: 0;
                            transform: scale(0.95);
                        }
                        to {
                            opacity: 1;
                            transform: scale(1);
                        }
                    }
                `}</style>

        {/* Icon */}
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: styles.iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}
        >
          {variant === 'danger' && <span style={{ fontSize: '24px' }}>⚠️</span>}
          {variant === 'warning' && <span style={{ fontSize: '24px' }}>⚠️</span>}
          {variant === 'info' && <span style={{ fontSize: '24px' }}>ℹ️</span>}
        </div>

        {/* Title */}
        <h3
          id="dialog-title"
          style={{
            fontSize: '1.25rem',
            fontWeight: '700',
            color: 'var(--text-primary)',
            marginBottom: '0.75rem',
            lineHeight: 1.3,
          }}
        >
          {title}
        </h3>

        {/* Message */}
        <p
          id="dialog-message"
          style={{
            fontSize: '0.95rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: '1.5rem',
          }}
        >
          {message}
        </p>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: '#ffffff',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#f9fafb';
              e.currentTarget.style.borderColor = '#d1d5db';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.borderColor = 'var(--border)';
            }}
          >
            {cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              background: styles.confirmBg,
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = styles.confirmHover;
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.15)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = styles.confirmBg;
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
