'use client';

import React from 'react';
import { toast as sonnerToast, type ExternalToast } from 'sonner';
import { toUserFacingError } from '@/lib/user-facing-error';
import {
  IncidentAlertToast,
  type IncidentAlertItem,
} from '@/components/incident/IncidentAlertToast';

export type { IncidentAlertItem };

type NotifyOptions = Omit<ExternalToast, 'description'> & {
  description?: string;
};

function stableId(type: string, title: string) {
  return `${type}:${title.toLowerCase().replace(/\s+/g, '-').slice(0, 80)}`;
}

function optionsFor(type: string, title: string, options?: NotifyOptions): ExternalToast {
  return {
    id: options?.id ?? stableId(type, title),
    ...options,
  };
}

export const notify = {
  success(title: string, options?: NotifyOptions) {
    return sonnerToast.success(title, {
      duration: 4000,
      ...optionsFor('success', title, options),
    });
  },

  error(error: unknown, options?: NotifyOptions) {
    const friendly = toUserFacingError(error);
    const friendlyDescription = options?.description
      ? toUserFacingError(options.description)
      : undefined;
    return sonnerToast.error(friendly.title, {
      duration: 8000,
      ...optionsFor('error', friendly.title, options),
      description: friendlyDescription
        ? friendlyDescription.description || friendlyDescription.title
        : friendly.description,
    });
  },

  warning(title: string, options?: NotifyOptions) {
    return sonnerToast.warning(title, {
      duration: 7000,
      ...optionsFor('warning', title, options),
    });
  },

  info(title: string, options?: NotifyOptions) {
    return sonnerToast.info(title, {
      duration: 6000,
      ...optionsFor('info', title, options),
    });
  },

  loading(title: string, options?: NotifyOptions) {
    return sonnerToast.loading(title, optionsFor('loading', title, options));
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
        position: 'top-right',
      }
    );
  },

  dismiss(id?: string | number) {
    sonnerToast.dismiss(id);
  },
};
