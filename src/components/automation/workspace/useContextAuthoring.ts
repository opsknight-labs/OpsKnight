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
      const raw = response.data as Observation[];
      setDiscoveries(
        raw.map(item => ({
          ...item,
          source: 'PROVIDER' as const,
          integrationType: integrationType === 'ALL' ? undefined : integrationType,
        }))
      );
    } catch {
      onError('Enter a valid JSON provider sample');
    }
  }, [serviceId, providerSample, integrationType, onError]);

  const addField = useCallback(() => {
    const existingKeys = new Set([...builtinFields, ...draft.fields].map(field => field.key));
    const baseKey = fieldLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const key = /^[a-z]/.test(baseKey) ? baseKey : `field_${baseKey}`;
    const taken = existingKeys.has(key);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || taken || !observedPath) {
      onError('Choose a unique field name and an observed source field');
      return;
    }
    const matchingDiscovery = discoveries.find(item => item.path === observedPath);
    const source = matchingDiscovery?.source ?? 'PROVIDER';
    const effectiveIntegration = matchingDiscovery?.integrationType ?? integrationType;
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
          displayOnly: false,
          ...(fieldType === 'ENUM' ? { allowedValues: values } : {}),
          aliases: {},
          mappings: [
            {
              source,
              integrationType:
                source === 'EVENT' || effectiveIntegration === 'ALL'
                  ? undefined
                  : effectiveIntegration,
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
