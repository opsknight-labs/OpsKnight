'use client';

import { useEffect, useRef } from 'react';
import StatusPageSubscribe from './StatusPageSubscribe';

interface StatusPageSubscribeModalProps {
  open: boolean;
  statusPageId: string;
  services: Array<{ id: string; name: string }>;
  rssHref?: string | null;
  onClose: () => void;
}

export default function StatusPageSubscribeModal({
  open,
  statusPageId,
  services,
  rssHref,
  onClose,
}: StatusPageSubscribeModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Remember trigger for focus-return on close.
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Initial focus: email field first, otherwise first focusable.
    const frame = requestAnimationFrame(() => {
      if (!dialog) return;
      const email = dialog.querySelector<HTMLInputElement>('input[type="email"]');
      if (email) {
        email.focus();
        return;
      }
      const fallback = dialog.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      fallback?.focus();
    });

    const getFocusable = (): HTMLElement[] => {
      if (!dialog) return [];
      const nodes = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      // Keep visibly focusable candidates; offsetParent filters display:none trees.
      return Array.from(nodes).filter(
        el => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true'
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      const toFocus = previousFocusRef.current;
      if (toFocus && typeof toFocus.focus === 'function' && document.contains(toFocus)) {
        // Defer so the unmount doesn't steal focus back.
        requestAnimationFrame(() => toFocus.focus());
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="status-subscribe-overlay"
      ref={backdropRef}
      onClick={e => {
        if (e.target === backdropRef.current) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="status-subscribe-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscribe-modal-heading"
      >
        <div className="status-subscribe-modal__head">
          <h2 id="subscribe-modal-heading" className="status-subscribe-modal__title">
            Subscribe to updates
          </h2>
          <button type="button" className="status-subscribe-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="status-subscribe-modal__body">
          <StatusPageSubscribe
            statusPageId={statusPageId}
            services={services}
            variant="modal"
            rssHref={rssHref}
            onSuccess={() => {
              // Keep modal open to show success; user can dismiss via Done/Escape/overlay
            }}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
