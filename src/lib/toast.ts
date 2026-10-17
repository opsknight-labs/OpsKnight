'use client';

import React from 'react';
import { toast as sonnerToast, type ExternalToast } from 'sonner';
import { toUserFacingError } from '@/lib/user-facing-error';
import {
  IncidentAlertToast,
  type IncidentAlertItem,
} from '@/components/incident/IncidentAlertToast';
import {
  NotificationToast,
  type NotificationAction,
  type NotificationTone,
} from '@/components/ui/NotificationToast';

export type { IncidentAlertItem };

export type NotifyOptions = {
  id?: string | number;
  description?: string;
  duration?: number;
  action?: NotificationAction;
  onDismiss?: ExternalToast['onDismiss'];
  onAutoClose?: ExternalToast['onAutoClose'];
};

const DEFAULT_DURATION = new Map<NotificationTone, number>([
  ['success', 4000],
  ['info', 6000],
  ['warning', 7000],
  ['error', 8000],
  // Loading toasts stay until they are replaced (same id) or dismissed.
  ['loading', Infinity],
]);

function stableId(type: string, title: string) {
  return `${type}:${title.toLowerCase().replace(/\s+/g, '-').slice(0, 80)}`;
}

function show(tone: NotificationTone, title: string, options?: NotifyOptions) {
  const { id, description, duration, action, onDismiss, onAutoClose } = options ?? {};
  return sonnerToast.custom(
    toastId =>
      React.createElement(NotificationToast, {
        tone,
        title,
        description,
        action,
        onClose: () => sonnerToast.dismiss(toastId),
      }),
    {
      id: id ?? stableId(tone, title),
      duration: duration ?? DEFAULT_DURATION.get(tone),
      className: `ok-toast-item ok-toast-item--${tone}`,
      onDismiss,
      onAutoClose,
    }
  );
}

export const notify = {
  success(title: string, options?: NotifyOptions) {
    return show('success', title, options);
  },

  error(error: unknown, options?: NotifyOptions) {
    const friendly = toUserFacingError(error);
    const friendlyDescription = options?.description
      ? toUserFacingError(options.description)
      : undefined;
    return show('error', friendly.title, {
      ...options,
      description: friendlyDescription
        ? friendlyDescription.description || friendlyDescription.title
        : friendly.description,
    });
  },

  warning(title: string, options?: NotifyOptions) {
    return show('warning', title, options);
  },

  info(title: string, options?: NotifyOptions) {
    return show('info', title, options);
  },

  loading(title: string, options?: NotifyOptions) {
    return show('loading', title, options);
  },

  incident(
    incidents: IncidentAlertItem | IncidentAlertItem[],
    options?: {
      onAcknowledge?: (id: string) => Promise<void> | void;
      duration?: number;
    }
  ) {
    const list = Array.isArray(incidents) ? incidents : [incidents];
    if (list.length === 0) return;

    const toastId = `incident-alert:${list
      .map(i => i.id)
      .sort()
      .join(',')}`;

    return sonnerToast.custom(
      t =>
        React.createElement(IncidentAlertToast, {
          toastId: t,
          incidents: list,
          onAcknowledge: options?.onAcknowledge,
        }),
      {
        id: toastId,
        duration: options?.duration ?? 8000,
        className: 'ok-toast-item ok-toast-item--incident',
      }
    );
  },

  dismiss(id?: string | number) {
    sonnerToast.dismiss(id);
  },
};
