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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Prevent background scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
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
      <div className="status-subscribe-modal" role="dialog" aria-modal="true" aria-labelledby="subscribe-modal-heading">
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
