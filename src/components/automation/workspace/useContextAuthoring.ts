'use client';
import { useCallback, useState } from 'react';
import { automationAction } from '@/app/(app)/services/[id]/automation/actions';
import { builtinFields, type Field, type Snapshot } from '@/lib/automation/contract';
import type { Observation } from '@/lib/automation/discovery';
import { notify } from '@/lib/toast';
import type { Discovery } from '../presentation-types';
import { deriveUniqueFieldKey } from '../authoring/context-fields';
import { defaultProviderSample } from './constants';

/** Field-authoring form state for the Context section; kept here so it survives tab switches. */
export function useContextAuthoring({
  serviceId,
  draft,
  edit,
  onError,
  onNotify,
}: {
  serviceId: string;
  draft: Snapshot;
  edit: (snapshot: Snapshot) => void;
  onError: (message: string) => void;
  onNotify?: (message: string, tone?: 'success' | 'info' | 'error', description?: string) => void;
}) {
  const [contextSearch, setContextSearch] = useState('');
  const [providerSample, setProviderSample] = useState(defaultProviderSample);
  const [integrationType, setIntegrationType] = useState('EVENTS_API');
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [fieldLabel, setFieldLabel] = useState('Environment');
  const [fieldType, setFieldType] = useState<Field['type']>('ENUM');
  const [observedPath, setObservedPath] = useState('');
  const [selectedSource, setSelectedSource] = useState<'PROVIDER' | 'EVENT' | undefined>(undefined);
  const [selectedIntegrationType, setSelectedIntegrationType] = useState<string | undefined>(
    undefined
  );
  const [values, setValues] = useState<string[]>(['production', 'staging', 'development']);
  const [advanced, setAdvanced] = useState(false);

  const handleManualPathChange = useCallback((nextPath: string) => {
    setObservedPath(nextPath);
    setSelectedIntegrationType(undefined);
  }, []);

  const selectObservedField = useCallback(
    (
      field: {
        path: string;
        source?: 'PROVIDER' | 'EVENT';
        integrationType?: string;
        label?: string;
        type?: Field['type'];
      } | null
    ) => {
      if (!field) {
        setObservedPath('');
        setSelectedSource(undefined);
        setSelectedIntegrationType(undefined);
        return;
      }
      setObservedPath(field.path);
      setSelectedSource(field.source);
      setSelectedIntegrationType(field.integrationType);
      if (field.label) {
        setFieldLabel(field.label);
      }
      if (field.type) {
        setFieldType(field.type);
      }
      if (field.integrationType && field.integrationType !== 'ALL') {
        setIntegrationType(field.integrationType);
      }
    },
    []
  );

  const handleIntegrationTypeChange = useCallback(
    (nextType: string) => {
      setIntegrationType(nextType);
      if (nextType === 'ALL') {
        setSelectedIntegrationType(undefined);
      } else if (
        nextType !== 'ALL' &&
        selectedIntegrationType &&
        selectedIntegrationType !== nextType
      ) {
        setObservedPath('');
        setSelectedSource(undefined);
        setSelectedIntegrationType(undefined);
      }
    },
    [selectedIntegrationType]
  );

  const analyze = useCallback(async () => {
    try {
      const response = await automationAction({
        action: 'discover',
        serviceId,
        sample: JSON.parse(providerSample),
      });
      if (!response.ok) {
        onError(response.error);
        notify.error(response.error, { id: 'automation:context:discover-error' });
        onNotify?.(response.error, 'error');
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
      const discMsg = `Discovered ${raw.length} fields from sample payload`;
      notify.info(discMsg, { id: 'automation:context:discover' });
      onNotify?.(discMsg, 'info');
    } catch {
      const err = 'Enter a valid JSON provider sample';
      onError(err);
      notify.error(err, { id: 'automation:context:discover-json-error' });
      onNotify?.(err, 'error');
    }
  }, [serviceId, providerSample, integrationType, onError, onNotify]);

  const addField = useCallback(() => {
    const existingKeys = new Set([...builtinFields, ...draft.fields].map(field => field.key));
    const key = deriveUniqueFieldKey(fieldLabel, existingKeys);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || !observedPath) {
      const errMsg = 'Choose a unique field name and an observed source field';
      onError(errMsg);
      notify.error(errMsg, { id: 'automation:context:field-add-error' });
      onNotify?.(errMsg, 'error');
      return;
    }
    const matchingDiscovery = discoveries.find(
      item =>
        item.path === observedPath &&
        (!selectedSource || item.source === selectedSource) &&
        (selectedIntegrationType &&
        selectedIntegrationType !== 'ALL' &&
        selectedIntegrationType !== 'EVENTS_API'
          ? item.integrationType === selectedIntegrationType ||
            (item.integrationType === undefined && selectedSource === 'EVENT')
          : integrationType && integrationType !== 'ALL' && integrationType !== 'EVENTS_API'
            ? item.integrationType === integrationType ||
              (item.integrationType === undefined && selectedSource === 'EVENT')
            : !item.integrationType ||
              item.integrationType === 'ALL' ||
              item.integrationType === 'EVENTS_API')
    );
    const effectiveIntegration =
      integrationType === 'ALL' ||
      (matchingDiscovery &&
        !matchingDiscovery.integrationType &&
        matchingDiscovery.source === 'EVENT')
        ? undefined
        : (selectedIntegrationType ?? integrationType);
    const source =
      selectedSource ??
      matchingDiscovery?.source ??
      (effectiveIntegration === 'EVENTS_API' ? 'EVENT' : 'PROVIDER');
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
              integrationType: effectiveIntegration,
              path: observedPath,
            },
          ],
        },
      ],
    });

    const successMsg = `Context field "${fieldLabel.trim()}" added`;
    const desc = `Field mapped to ${observedPath} is now available for rule conditions.`;
    notify.success(successMsg, {
      id: `automation:field:${key}:add`,
      description: desc,
    });
    onNotify?.(successMsg, 'success', desc);
  }, [
    draft,
    edit,
    discoveries,
    fieldLabel,
    fieldType,
    integrationType,
    observedPath,
    onError,
    onNotify,
    selectedIntegrationType,
    selectedSource,
    values,
  ]);

  return {
    contextSearch,
    setContextSearch,
    providerSample,
    setProviderSample,
    integrationType,
    setIntegrationType,
    handleIntegrationTypeChange,
    selectObservedField,
    handleManualPathChange,
    discoveries,
    setDiscoveries,
    fieldLabel,
    setFieldLabel,
    fieldType,
    setFieldType,
    observedPath,
    setObservedPath: handleManualPathChange,
    selectedSource,
    setSelectedSource,
    selectedIntegrationType,
    setSelectedIntegrationType,
    values,
    setValues,
    advanced,
    setAdvanced,
    analyze,
    addField,
  };
}
