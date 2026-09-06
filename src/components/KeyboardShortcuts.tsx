'use client';

import { useEffect, useRef } from 'react';

type Shortcut = {
  keys: string[];
  description: string;
  category: string;
  action?: () => void;
};

const shortcuts: Shortcut[] = [
  { keys: ['?'], description: 'Show keyboard shortcuts', category: 'Navigation' },
  { keys: ['⌘', '/'], description: 'Show keyboard shortcuts', category: 'Navigation' },
  { keys: ['G', 'D'], description: 'Go to Dashboard', category: 'Navigation' },
  { keys: ['G', 'I'], description: 'Go to Incidents', category: 'Navigation' },
  { keys: ['G', 'S'], description: 'Go to Services', category: 'Navigation' },
  { keys: ['G', 'T'], description: 'Go to Teams', category: 'Navigation' },
  { keys: ['G', 'U'], description: 'Go to Users', category: 'Navigation' },
  { keys: ['G', 'C'], description: 'Go to Schedules', category: 'Navigation' },
  { keys: ['G', 'P'], description: 'Go to Policies', category: 'Navigation' },
  { keys: ['G', 'A'], description: 'Go to Analytics', category: 'Navigation' },
  { keys: ['⌘', 'N'], description: 'New Incident', category: 'Actions' },
  { keys: ['⌘', 'R'], description: 'Refresh Dashboard', category: 'Actions' },
  { keys: ['⌘', 'E'], description: 'Export CSV', category: 'Actions' },
  { keys: ['Esc'], description: 'Close modal/dialog', category: 'Actions' },
  { keys: ['J'], description: 'Next incident in list', category: 'Incident Triage' },
  { keys: ['K'], description: 'Previous incident in list', category: 'Incident Triage' },
  { keys: ['X'], description: 'Select / deselect incident', category: 'Incident Triage' },
  { keys: ['A'], description: 'Acknowledge focused incident', category: 'Incident Triage' },
  { keys: ['R'], description: 'Resolve focused incident (with note)', category: 'Incident Triage' },
  { keys: ['/'], description: 'Focus search bar', category: 'Incident Triage' },
];

export default function KeyboardShortcuts({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      // Prevent shortcuts from triggering when modal is open
      if (e.key === '?' || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
        e.preventDefault();
      }
    };

    // Focus trap - keep focus within modal
    const handleTab = (e: KeyboardEvent) => {
      if (!modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleTab);

    // Focus the close button when modal opens
    const closeButton = modalRef.current?.querySelector(
      'button[aria-label="Close"]'
    ) as HTMLElement;
    setTimeout(() => closeButton?.focus(), 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleTab);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const grouped = shortcuts.reduce(
    (acc, shortcut) => {
      if (!acc[shortcut.category]) {
        acc[shortcut.category] = [];
      }
      acc[shortcut.category].push(shortcut);
      return acc;
    },
    {} as Record<string, Shortcut[]>
  );

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '2rem',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
    >
      <div
        ref={modalRef}
        style={{
          background: 'white',
          borderRadius: '0px',
          maxWidth: '700px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(211, 47, 47, 0.3), 0 0 0 1px rgba(211, 47, 47, 0.1)',
          border: '2px solid var(--primary-color)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header with red accent */}
        <div
          style={{
            padding: '1.75rem 2rem',
            borderBottom: '2px solid var(--primary-color)',
            background: 'linear-gradient(135deg, #fee2e2 0%, #ffffff 100%)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                background: 'var(--primary-color)',
                borderRadius: '0px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
                <rect x="4" y="2" width="16" height="20" rx="2" />
                <path d="M9 6h6m-6 4h6m-2 4h2" fill="white" />
              </svg>
            </div>
            <div>
              <h2
                id="keyboard-shortcuts-title"
                style={{
                  fontSize: '1.5rem',
                  fontWeight: '800',
                  margin: 0,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.5px',
                }}
              >
                Keyboard Shortcuts
              </h2>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  margin: '0.25rem 0 0 0',
                }}
              >
                Press{' '}
                <kbd
                  style={{
                    padding: '2px 6px',
                    background: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    borderRadius: '0px',
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                    fontWeight: '600',
                  }}
                >
                  Esc
                </kbd>{' '}
                to close
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: '2px solid var(--primary-color)',
              borderRadius: '0px',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: 'var(--primary-color)',
              padding: '0.5rem 0.75rem',
              lineHeight: 1,
              fontWeight: '600',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--primary-color)';
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--primary-color)';
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            padding: '2rem',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {Object.entries(grouped).map(([category, items], categoryIndex) => (
            <div
              key={category}
              style={{
                marginBottom: categoryIndex < Object.keys(grouped).length - 1 ? '2.5rem' : '0',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '1.25rem',
                  paddingBottom: '0.75rem',
                  borderBottom: '2px solid var(--primary-color)',
                }}
              >
                <div
                  style={{
                    width: '4px',
                    height: '20px',
                    background: 'var(--primary-color)',
                    borderRadius: '0px',
                  }}
                />
                <h3
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: '800',
                    textTransform: 'uppercase',
                    letterSpacing: '1.5px',
                    color: 'var(--primary-color)',
                    margin: 0,
                  }}
                >
                  {category}
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {items.map((shortcut, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem 1.25rem',
                      background: index % 2 === 0 ? '#fef2f2' : 'white',
                      border: '1px solid #fee2e2',
                      borderRadius: '0px',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = '#fee2e2';
                      e.currentTarget.style.borderColor = 'var(--primary-color)';
                      e.currentTarget.style.transform = 'translateX(4px)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = index % 2 === 0 ? '#fef2f2' : 'white';
                      e.currentTarget.style.borderColor = '#fee2e2';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.95rem',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {shortcut.description}
                    </span>
                    <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                      {shortcut.keys.map((key, keyIndex) => (
                        <kbd
                          key={keyIndex}
                          style={{
                            padding: '0.375rem 0.625rem',
                            background:
                              key === '⌘' || key === 'Ctrl' ? 'var(--primary-color)' : '#f3f4f6',
                            border: `2px solid ${key === '⌘' || key === 'Ctrl' ? 'var(--primary-color)' : '#d1d5db'}`,
                            borderRadius: '0px',
                            fontSize: '0.8rem',
                            fontFamily: 'monospace',
                            fontWeight: '700',
                            color: key === '⌘' || key === 'Ctrl' ? 'white' : 'var(--text-primary)',
                            minWidth: '32px',
                            textAlign: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                          }}
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1.25rem 2rem',
            borderTop: '2px solid var(--primary-color)',
            background: '#fef2f2',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>Use these shortcuts to navigate faster</span>
          <span style={{ fontWeight: '600', color: 'var(--primary-color)' }}>OpsKnight</span>
        </div>
      </div>
    </div>
  );
}
