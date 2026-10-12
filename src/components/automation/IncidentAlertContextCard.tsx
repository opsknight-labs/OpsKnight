import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import type { Field } from '@/lib/automation/contract';

type CapturedValue = { state: string; value?: unknown; raw?: unknown };
export default function IncidentAlertContextCard({
  fields,
  context,
  versionNumber,
  sensitive,
  omitted,
}: {
  fields: Field[];
  context: Record<string, CapturedValue>;
  versionNumber?: number;
  sensitive: boolean;
  omitted: boolean;
}) {
  const relevant = fields.filter(
    field => context[field.key] && context[field.key].state !== 'MISSING'
  );
  const visible = relevant.length ? relevant.slice(0, 6) : fields.slice(0, 6);
  const visibleKeys = new Set(visible.map(field => field.key));
  const remaining = fields.filter(field => !visibleKeys.has(field.key));
  function renderField(field: Field) {
    const value = context[field.key];
    const display =
      !value || value.state === 'MISSING'
        ? 'Not provided'
        : value.state === 'UNMAPPED'
          ? 'Unrecognized value'
          : value.value == null
            ? 'Diagnostic value unavailable'
            : String(value.value);
    const characters = [...display];
    return (
      <div key={field.key} className="min-w-0">
        <dt className="break-words font-medium">{field.label}</dt>
        <dd className="break-words text-muted-foreground">
          {characters.length > 160 ? (
            <>
              <span>{characters.slice(0, 160).join('')}…</span>
              <details>
                <summary className="cursor-pointer py-2" aria-label={`Show full ${field.label}`}>
                  Show full value
                </summary>
                <p className="break-words">{display}</p>
              </details>
            </>
          ) : (
            display
          )}
        </dd>
      </div>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          Alert Context <Badge variant="outline">Automation · v{versionNumber ?? '—'}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <p className="mb-3 text-muted-foreground">
          Mapped context captured when this incident was created.
        </p>
        {!sensitive ? (
          <p>Alert context is restricted.</p>
        ) : (
          <>
            {omitted && (
              <p className="mb-3">
                Some diagnostic values were omitted from the stored explanation.
              </p>
            )}
            {fields.length ? (
              <>
                <dl className="grid gap-3 sm:grid-cols-2">{visible.map(renderField)}</dl>
                {!!remaining.length && (
                  <details className="mt-3">
                    <summary className="cursor-pointer py-2">
                      Show {remaining.length} more context fields
                    </summary>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">{remaining.map(renderField)}</dl>
                  </details>
                )}
              </>
            ) : (
              <p>No mapped alert context was captured.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
