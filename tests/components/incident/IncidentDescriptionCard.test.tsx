import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IncidentDescriptionCard, {
  clickHouseLiteralToJson,
  expandStringValue,
} from '@/components/incident/detail/IncidentDescriptionCard';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('ClickHouse values in incident descriptions', () => {
  it('turns ClickHouse Map, Array and Tuple literals into JSON', () => {
    expect(JSON.parse(clickHouseLiteralToJson("{'host':'db-1','errors':42}")!)).toEqual({
      host: 'db-1',
      errors: 42,
    });
    expect(JSON.parse(clickHouseLiteralToJson("['a','b''s']") ?? 'null')).toBeNull();
    expect(JSON.parse(clickHouseLiteralToJson("[('db-1',3),('db-2',5)]")!)).toEqual([
      ['db-1', 3],
      ['db-2', 5],
    ]);
    expect(JSON.parse(clickHouseLiteralToJson("['it\\'s']")!)).toEqual(["it's"]);
  });

  it('leaves plain text and invalid literals alone', () => {
    expect(clickHouseLiteralToJson('CPU above 90%')).toBeNull();
    expect(clickHouseLiteralToJson('(see runbook)')).toBeNull();
    expect(expandStringValue('"single line"')).toBeNull();
  });

  it('expands multi-line strings and embedded JSON', () => {
    expect(expandStringValue(JSON.stringify('host=db-1\nerrors=42\n'))).toEqual({
      kind: 'text',
      text: 'host=db-1\nerrors=42',
    });
    expect(expandStringValue(JSON.stringify('{"a":1}'))?.kind).toBe('json');
    expect(expandStringValue(JSON.stringify("{'a':1}"))?.kind).toBe('json');
  });

  it('renders a Grafana ClickHouse alert description over several lines', () => {
    const description = JSON.stringify(
      {
        annotations: {
          description: 'host: db-1\nquery_duration_ms: 5400\nuser: default',
          values: "{'A':5400,'B':1}",
        },
      },
      null,
      2
    );
    render(<IncidentDescriptionCard incidentId="i1" description={description} canManage={false} />);
    expect(screen.getByText('query_duration_ms: 5400', { exact: false })).toBeTruthy();
    expect(screen.queryByText(/\\n/)).toBeNull();
    expect(screen.getByText('"A"')).toBeTruthy();
  });
});
