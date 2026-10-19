'use client';

import type { ComponentProps } from 'react';
import RunbookTargetSelect, {
  type RunbookTargetOptions,
} from '@/components/runbooks/RunbookTargetSelect';
import Field from '@/components/runbooks/RunbookField';
import RunbookBindingVersionInputs from '../RunbookBindingVersionInputs';
import AgentSelectorEditor from './AgentSelectorEditor';

/** Attach form: execution target plus static Agent selector labels. */
export function AttachTargetFields({
  agents,
  pools,
  hasAgentWrite,
}: RunbookTargetOptions & { hasAgentWrite: boolean }) {
  return (
    <>
      <Field label="Execution target">
        <RunbookTargetSelect agents={agents} pools={pools} hasAgentWrite={hasAgentWrite} />
      </Field>
      <AgentSelectorEditor defaultValue="{}" />
    </>
  );
}

/** Configure form: version/inputs/target plus static Agent selector labels. */
export function BindingVersionTargetFields({
  agentSelector,
  ...versionProps
}: ComponentProps<typeof RunbookBindingVersionInputs> & { agentSelector: string }) {
  return (
    <>
      <RunbookBindingVersionInputs {...versionProps} />
      <AgentSelectorEditor defaultValue={agentSelector} />
    </>
  );
}
