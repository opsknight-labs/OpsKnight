import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import IncidentAlertContextCard from '@/components/automation/IncidentAlertContextCard';
import type { Field } from '@/lib/automation/contract';

const fields: Field[] = [
  {
    fieldId: 'env',
    key: 'environment',
    label: 'Environment',
    type: 'STRING',
    caseSensitive: false,
    aliases: {},
    mappings: [],
  },
];

it('distinguishes received context from enrichment without claiming the provider sent the final value', () => {
  const html = renderToStaticMarkup(
    <IncidentAlertContextCard
      fields={fields}
      sensitive
      omitted={false}
      receivedContext={{ environment: { state: 'VALUE', value: 'staging' } }}
      context={{ environment: { state: 'VALUE', value: 'production' } }}
    />
  );
  expect(html).toContain('Received value');
  expect(html).toContain('staging');
  expect(html).toContain('Value after automation:');
  expect(html).toContain('production');
});

it('keeps unchanged context compact and hides both stages from restricted readers', () => {
  const context = { environment: { state: 'VALUE', value: 'private-environment' } };
  const render = (sensitive: boolean) =>
    renderToStaticMarkup(
      <IncidentAlertContextCard
        fields={fields}
        sensitive={sensitive}
        omitted={false}
        receivedContext={context}
        context={context}
      />
    );
  expect(render(true)).not.toContain('Received value');
  expect(render(false)).not.toContain('private-environment');
});
