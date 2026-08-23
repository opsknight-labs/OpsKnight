'use client';

import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { lockBodyScroll } from '@/lib/body-scroll-lock';
import { trapFocus } from '@/lib/focus-trap';

type MobileModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export default function MobileModal({
  isOpen,
  onClose,
  title,
  children,
  footer,
}: MobileModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    return lockBodyScroll();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!dialogRef.current) return;
    return trapFocus(dialogRef.current, onClose);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          animation: 'fadeIn 0.2s ease',
        }}
        onClick={onClose}
      />

      {/* Bottom Sheet */}
      <div
        data-swipe-ignore="true"
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--bg-surface)',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          zIndex: 1001,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideUp 0.3s ease',
          paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))',
        }}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        tabIndex={-1}
      >
        {/* Handle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '0.75rem',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '4px',
              background: 'var(--border)',
              borderRadius: '999px',
            }}
          />
        </div>

        {/* Header */}
        {title && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 1rem 0.75rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: '1.1rem',
                fontWeight: '700',
              }}
              id={titleId}
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              style={{
                background: 'none',
                border: 'none',
                padding: '0.5rem',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '1rem',
          }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              padding: '1rem',
              paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0))',
              borderTop: '1px solid var(--border)',
            }}
          >
            {footer}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

// Action Sheet variant
export function MobileActionSheet({
  isOpen,
  onClose,
  title,
  actions,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  actions: {
    label: string;
    icon?: ReactNode;
    variant?: 'default' | 'danger';
    onClick: () => void;
  }[];
}) {
  return (
    <MobileModal isOpen={isOpen} onClose={onClose} title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {actions.map((action, index) => (
          <button
            key={index}
            onClick={() => {
              action.onClick();
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              width: '100%',
              padding: '1rem',
              background: action.variant === 'danger' ? '#fee2e2' : 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              fontSize: '0.95rem',
              fontWeight: '500',
              color: action.variant === 'danger' ? '#dc2626' : 'var(--text-primary)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {action.icon && <span style={{ display: 'flex' }}>{action.icon}</span>}
            {action.label}
          </button>
        ))}

        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '1rem',
            background: 'var(--bg-secondary)',
            border: 'none',
            borderRadius: '12px',
            fontSize: '0.95rem',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            marginTop: '0.5rem',
          }}
        >
          Cancel
        </button>
      </div>
    </MobileModal>
  );
}

// Confirm Dialog
export function MobileConfirmDialog({
  isOpen,
  onClose,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
}) {
  const buttonColors = {
    primary: { bg: 'var(--primary-color)', color: 'white' },
    danger: { bg: '#dc2626', color: 'white' },
  };

  return (
    <MobileModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '0.875rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              fontSize: '0.95rem',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            style={{
              flex: 1,
              padding: '0.875rem',
              background: buttonColors[variant].bg,
              color: buttonColors[variant].color,
              border: 'none',
              borderRadius: '10px',
              fontSize: '0.95rem',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p
        style={{
          margin: 0,
          fontSize: '0.95rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>
    </MobileModal>
  );
}

// Hook for modal state
export function useMobileModal() {
  const [isOpen, setIsOpen] = useState(false);
  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);
  const toggle = () => setIsOpen(prev => !prev);
  return { isOpen, open, close, toggle };
}
