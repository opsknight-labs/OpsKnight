'use client';

import { useState, useCallback, useRef, useEffect, useActionState } from 'react';
import { createIncident } from '@/app/(app)/incidents/actions';

export type FormValues = {
  title: string;
  description?: string;
  serviceId: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  priority?: string;
  assigneeId?: string;
  dedupKey?: string;
};

interface UseCreateIncidentOptions {
  onSuccess?: (incidentId: string) => void;
  onError?: (error: string) => void;
  formRef?: React.MutableRefObject<any>;
}

interface UseCreateIncidentReturn {
  submitError: string | null;
  isPending: boolean;
  formAction: (formData: FormData) => void;
  onSubmit: (data: FormValues) => void;
  clearError: () => void;
}

/**
 * Shared hook for incident creation logic
 * Handles: error state, pending state, form submission, success/error callbacks
 * Eliminates duplication between CreateIncidentModal and CreateIncidentFormModern
 */
export function useCreateIncident(options: UseCreateIncidentOptions = {}): UseCreateIncidentReturn {
  const { onSuccess, onError, formRef } = options;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Server Action with error handling wrapper
  const [state, formAction, isPending] = useActionState<
    { id: string; error?: string } | null,
    FormData
  >(async (_prev: { id: string; error?: string } | null, formData: FormData) => {
    try {
      return await createIncident(formData);
    } catch (error) {
      return { id: '', error: error instanceof Error ? error.message : 'An error occurred' };
    }
  }, null);

  // Handle server action response
  useEffect(() => {
    if (state?.error) {
      setSubmitError(state.error);
      onError?.(state.error);
    } else if (state?.id) {
      setSubmitError(null);
      onSuccess?.(state.id);
      // Reset form if formRef is provided
      if (formRef?.current) {
        formRef.current.reset({
          title: '',
          description: '',
          serviceId: '',
          urgency: 'HIGH',
          priority: '',
          assigneeId: 'unassigned',
          dedupKey: '',
        });
      }
    }
  }, [state, onSuccess, onError, formRef]);

  const clearError = useCallback(() => {
    setSubmitError(null);
  }, []);

  const onSubmit = useCallback(
    (data: FormValues) => {
      clearError();
      const formData = new FormData();
      formData.append('title', data.title);
      formData.append('description', data.description || '');
      formData.append('serviceId', data.serviceId);
      formData.append('urgency', data.urgency);
      if (data.priority) formData.append('priority', data.priority);
      if (data.assigneeId && data.assigneeId !== 'unassigned') {
        if (data.assigneeId.startsWith('team:')) {
          formData.append('teamId', data.assigneeId.replace('team:', ''));
        } else if (data.assigneeId.startsWith('user:')) {
          formData.append('assigneeId', data.assigneeId.replace('user:', ''));
        } else {
          formData.append('assigneeId', data.assigneeId);
        }
      }
      if (data.dedupKey) formData.append('dedupKey', data.dedupKey);
      formAction(formData);
    },
    [formAction, clearError]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    submitError,
    isPending,
    formAction,
    onSubmit,
    clearError,
  };
}
