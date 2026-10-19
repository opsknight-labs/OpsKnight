'use client';
import { useCallback, useState } from 'react';
import { automationAction } from '@/app/(app)/services/[id]/automation/actions';
import { builtinFields, type Field, type Snapshot } from '@/lib/automation/contract';
import type { Observation } from '@/lib/automation/discovery';
import type { Discovery } from '../presentation-types';
import { defaultProviderSample } from './constants';

/** Field-authoring form state for the Context section; kept here so it survives tab switches. */
export function useContextAuthoring({
  serviceId,
  draft,
  edit,
  onError,
}: {
  serviceId: string;
  draft: Snapshot;
  edit: (snapshot: Snapshot) => void;
  onError: (message: string) => void;
}) {
  const [contextSearch, setContextSearch] = useState('');
  const [providerSample, setProviderSample] = useState(defaultProviderSample);
  const [integrationType, setIntegrationType] = useState('EVENTS_API');
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [fieldLabel, setFieldLabel] = useState('Environment');
  const [fieldType, setFieldType] = useState<Field['type']>('ENUM');
  const [observedPath, setObservedPath] = useState('');
  const [values, setValues] = useState<string[]>(['production', 'staging', 'development']);
  const [advanced, setAdvanced] = useState(false);

  const analyze = useCallback(async () => {
    try {
      const response = await automationAction({
        action: 'discover',
        serviceId,
        sample: JSON.parse(providerSample),
      });
      if (!response.ok) {
        onError(response.error);
        return;
      }
      setDiscoveries(response.data as Observation[]);
    } catch {
      onError('Enter a valid JSON provider sample');
    }
  }, [serviceId, providerSample, onError]);

  const addField = useCallback(() => {
    const key = fieldLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
    const taken = [...builtinFields, ...draft.fields].some(field => field.key === key);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || taken || !observedPath) {
      onError('Choose a unique field name and an observed source field');
      return;
    }
    const source = discoveries.find(item => item.path === observedPath)?.source;
    edit({
      ...draft,
      fields: [
        ...draft.fields,
        {
          fieldId: crypto.randomUUID(),
          key,
          label: fieldLabel.trim(),
          type: fieldType,
          caseSensitive: false,
          ...(fieldType === 'ENUM' ? { allowedValues: values } : {}),
          aliases: {},
          mappings: [
            {
              source: source ?? 'PROVIDER',
              integrationType:
                source === 'EVENT' || integrationType === 'ALL' ? undefined : integrationType,
              path: observedPath,
            },
          ],
        },
      ],
    });
  }, [
    draft,
    edit,
    discoveries,
    fieldLabel,
    fieldType,
    integrationType,
    observedPath,
    onError,
    values,
  ]);

  return {
    contextSearch,
    setContextSearch,
    providerSample,
    setProviderSample,
    integrationType,
    setIntegrationType,
    discoveries,
    setDiscoveries,
    fieldLabel,
    setFieldLabel,
    fieldType,
    setFieldType,
    observedPath,
    setObservedPath,
    values,
    setValues,
    advanced,
    setAdvanced,
    analyze,
    addField,
  };
}
