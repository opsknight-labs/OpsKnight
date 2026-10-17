'use client';

import { Check, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NotificationTone = 'success' | 'error' | 'warning' | 'info' | 'loading';

export type NotificationAction = {
  label: string;
  onClick: () => void;
};

export interface NotificationToastProps {
  tone: NotificationTone;
  title: string;
  description?: string;
  action?: NotificationAction;
  /** Dismisses this toast; supplied by notify() so the body stays Sonner-agnostic. */
  onClose: () => void;
}

function ToneIcon({ tone }: { tone: NotificationTone }) {
  const className = 'h-4 w-4';
  switch (tone) {
    case 'success':
      return <Check className={className} strokeWidth={2.75} />;
    case 'error':
      // An exclamation reads as "error" without echoing the close button's X.
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor">
          <path d="M12 5v9" strokeWidth={3} strokeLinecap="round" />
          <circle cx="12" cy="19" r="1.75" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'warning':
      return <TriangleAlert className={className} strokeWidth={2.25} />;
    case 'info':
      return <Info className={className} strokeWidth={2.25} />;
    case 'loading':
      return (
        <LoaderCircle
          className={cn(className, 'animate-spin motion-reduce:animate-none')}
          strokeWidth={2.25}
        />
      );
  }
}

/**
 * Body of every product notification. The surrounding Sonner <li> paints the
 * card surface (see src/styles/components/toasts.css) so stacked toasts peek
 * and collapse correctly; this component only lays out the content.
 */
export function NotificationToast({
  tone,
  title,
  description,
  action,
  onClose,
}: NotificationToastProps) {
  return (
    <div data-tone={tone} className="ok-toast flex items-start gap-3 py-3 pl-3.5 pr-11">
      <span data-testid="toast-icon" className="ok-toast__icon" aria-hidden="true">
        <ToneIcon tone={tone} />
      </span>

      <div className="min-w-0 flex-1 pt-[5px]">
        <p data-testid="toast-title" className="ok-toast__title">
          {title}
        </p>
        {description && (
          <p data-testid="toast-description" className="ok-toast__description">
            {description}
          </p>
        )}
        {action && (
          <button
            type="button"
            className="ok-toast__action"
            onClick={() => {
              action.onClick();
              onClose();
            }}
          >
            {action.label}
          </button>
        )}
      </div>

      <button
        type="button"
        className="ok-toast__close"
        aria-label="Close notification"
        onClick={onClose}
      >
        <X className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}

export default NotificationToast;
