'use client';
import { useCallback, useState } from 'react';
import { automationAction } from '@/app/(app)/services/[id]/automation/actions';
import type { Snapshot } from '@/lib/automation/contract';
import type { testAutomation } from '@/lib/automation/testing';
import { defaultSample } from './constants';

export type TestResult = Awaited<ReturnType<typeof testAutomation>>;

/** Sample-test inputs and the latest result for the Test section. */
export function useSampleTest({
  serviceId,
  draft,
  providerSample,
  integrationType,
  setBusy,
  onError,
}: {
  serviceId: string;
  draft: Snapshot;
  providerSample: string;
  integrationType: string;
  setBusy: (busy: boolean) => void;
  onError: (message: string) => void;
}) {
  const [sample, setSample] = useState(defaultSample);
  const [integrationId, setIntegrationId] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);

  const runTest = useCallback(async () => {
    setBusy(true);
    onError('');
    try {
      const response = await automationAction({
        action: 'test',
        serviceId,
        snapshot: draft,
        event: JSON.parse(sample),
        providerPayload: JSON.parse(providerSample),
        integrationType,
        ...(integrationId ? { integrationId } : {}),
      });
      if (!response.ok) onError(response.error);
      else setResult(response.data as TestResult);
    } catch {
      onError('Enter valid event and provider JSON');
    } finally {
      setBusy(false);
    }
  }, [serviceId, draft, sample, providerSample, integrationType, integrationId, setBusy, onError]);

  return { sample, setSample, integrationId, setIntegrationId, result, runTest };
}
