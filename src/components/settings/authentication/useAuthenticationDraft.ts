'use client';
import { useEffect, useRef, useState, type SetStateAction } from 'react';
import type { ProviderConfiguration } from '@/lib/auth-control/provider-config';

type Draft = { configuration: ProviderConfiguration; profileJson: string; domainText: string };
const signature = (value: Draft) =>
  JSON.stringify([value.configuration, value.profileJson, value.domainText]);

/** One in-memory draft shared by all sections. Secrets are never persisted in browser storage. */
export function useAuthenticationDraft(initial: ProviderConfiguration) {
  const [draftGeneration, setDraftGeneration] = useState(0);
  const [configuration, setConfigurationState] = useState(initial);
  const [profileJson, setProfileState] = useState(JSON.stringify(initial.profileMapping, null, 2));
  const [domainText, setDomainState] = useState(initial.allowedDomains.join(', '));
  const initialDraft: Draft = {
    domainText: initial.allowedDomains.join(', '),
    configuration: initial,
    profileJson: JSON.stringify(initial.profileMapping, null, 2),
  };
  const current = useRef<Draft>(initialDraft);
  const [baseline, setBaseline] = useState(() => signature(initialDraft));
  const [baselineDraft, setBaselineDraft] = useState<Draft>(initialDraft);
  const setConfiguration = (action: SetStateAction<ProviderConfiguration>) => {
    const next = typeof action === 'function' ? action(current.current.configuration) : action;
    current.current = {
      ...current.current,
      configuration: next,
      domainText: next.allowedDomains.join(', '),
    };
    setDomainState(next.allowedDomains.join(', '));
    setConfigurationState(next);
  };
  const setProfileJson = (action: SetStateAction<string>) => {
    const next = typeof action === 'function' ? action(current.current.profileJson) : action;
    current.current = { ...current.current, profileJson: next };
    setProfileState(next);
  };
  const setDomainText = (value: string) => {
    current.current = { ...current.current, domainText: value };
    setDomainState(value);
  };
  const draftDirty = signature({ configuration, profileJson, domainText }) !== baseline;
  const setDraftDirty = (dirty: boolean) => {
    if (!dirty) {
      setDraftGeneration(value => value + 1);
      setBaseline(signature(current.current));
      setBaselineDraft(current.current);
    }
  };
  const discard = () => {
    setDraftGeneration(value => value + 1);
    setConfiguration(baselineDraft.configuration);
    setProfileJson(baselineDraft.profileJson);
    setDomainText(baselineDraft.domainText);
  };
  useEffect(() => {
    if (!draftDirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [draftDirty]);
  return {
    draftGeneration,
    domainText,
    setDomainText,
    configuration,
    setConfiguration,
    profileJson,
    setProfileJson,
    draftDirty,
    setDraftDirty,
    discard,
  };
}
