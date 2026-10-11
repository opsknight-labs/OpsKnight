'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { FormSelect } from '../../RunbookControls';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';

interface HttpActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  inputs: RunbookInputInput[];
  editorId?: string;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

export default function HttpActionEditor({
  config,
  errors = {},
  inputs,
  editorId = 'http',
  readOnly = false,
  onChange,
}: HttpActionEditorProps) {
  const [headerError, setHeaderError] = useState('');
  const [headerText, setHeaderText] = useState(() => JSON.stringify(config.headers ?? {}, null, 2));
  const method = String(config.method ?? 'GET').toUpperCase();
  const url = String(config.url ?? '');
  const rawBody = config.body;
  const isObjectBody = typeof rawBody === 'object' && rawBody !== null;
  const bodyString = isObjectBody ? JSON.stringify(rawBody, null, 2) : String(rawBody ?? '');
  const isNoBodyMethod = ['GET', 'HEAD'].includes(method);

  const update = (patch: Record<string, unknown>) => {
    onChange({ ...config, ...patch });
  };

  const handleMethodChange = (nextMethod: string) => {
    const normalized = nextMethod.toUpperCase();
    const nextIsNoBody = ['GET', 'HEAD'].includes(normalized);
    const nextConfig: Record<string, unknown> = { ...config, method: normalized };
    if (nextIsNoBody) {
      delete nextConfig.body;
    }
    onChange(nextConfig);
  };

  const handleBodyChange = (text: string) => {
    let finalVal: unknown = text;
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        finalVal = JSON.parse(text);
      } catch {
        finalVal = text;
      }
    }
    update({ body: finalVal });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={`http-method-${editorId}`}>HTTP Method</Label>
          <div className="mt-1.5">
            <FormSelect
              name={`http-method-${editorId}`}
              label="HTTP Method"
              value={method}
              disabled={readOnly}
              onValueChange={handleMethodChange}
              options={HTTP_METHODS.map(m => ({ value: m, label: m }))}
            />
          </div>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor={`http-url-${editorId}`}>Endpoint URL</Label>
          <div className="mt-1.5">
            <Input
              id={`http-url-${editorId}`}
              aria-label="URL or input reference"
              placeholder="https://api.internal/health or ${{ inputs.url }}"
              value={url}
              disabled={readOnly}
              onChange={e => update({ url: e.target.value })}
              className={errors.url ? 'border-destructive' : ''}
            />
          </div>
          {errors.url ? (
            <p className="mt-1 text-xs text-destructive">{errors.url}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Absolute URL or parameter template like{' '}
              <code className="text-[11px] font-mono">{'${{ inputs.api_url }}'}</code>.
            </p>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor={`http-headers-${editorId}`}>Request headers (JSON object)</Label>
        <Textarea
          id={`http-headers-${editorId}`}
          aria-label="Request headers"
          disabled={readOnly}
          value={headerText}
          className="mt-1.5 font-mono text-xs"
          onChange={event => {
            setHeaderText(event.target.value);
            try {
              const headers: unknown = JSON.parse(event.target.value || '{}');
              if (
                !headers ||
                typeof headers !== 'object' ||
                Array.isArray(headers) ||
                Object.values(headers).some(value => typeof value !== 'string')
              )
                throw new Error();
              setHeaderError('');
              update({ headers });
            } catch {
              setHeaderError('Use a JSON object with string header values.');
              update({ headers: event.target.value });
            }
          }}
        />
        {(headerError || errors.headers) && (
          <p role="alert" className="text-xs text-destructive">
            {headerError || errors.headers}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Control-plane HTTP cannot consume SECRET_REF inputs. Use a scoped Agent action for
          secret-backed requests.
        </p>
      </div>
      <div>
        <Label htmlFor={`http-status-${editorId}`}>Expected HTTP status (optional)</Label>
        <Input
          id={`http-status-${editorId}`}
          aria-label="Expected HTTP status"
          type="number"
          min={100}
          max={599}
          disabled={readOnly}
          value={String(config.expectedStatus ?? '')}
          onChange={event => {
            const next = { ...config };
            if (event.target.value === '') delete next.expectedStatus;
            else next.expectedStatus = Number(event.target.value);
            onChange(next);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Without an expected status, any 2xx response succeeds. Output is bounded; redirects are
          rejected.
        </p>
      </div>

      {!isNoBodyMethod && (
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`http-body-${editorId}`}>Request Body</Label>
            <span className="text-xs text-muted-foreground">
              {isObjectBody ? 'Structured JSON payload' : 'JSON or plaintext payload'}
            </span>
          </div>
          <div className="mt-1.5">
            <Textarea
              id={`http-body-${editorId}`}
              aria-label="Request body"
              placeholder='{"status": "maintenance"}'
              value={bodyString}
              disabled={readOnly}
              onChange={e => handleBodyChange(e.target.value)}
              className="font-mono text-xs min-h-24"
              spellCheck={false}
            />
          </div>
          {errors.body && <p className="mt-1 text-xs text-destructive">{errors.body}</p>}
        </div>
      )}

      {inputs.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-2.5 text-xs">
          <span className="font-medium text-muted-foreground">Available Input Variables: </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {inputs.map(input => (
              <button
                key={input.key}
                type="button"
                disabled={readOnly}
                onClick={() =>
                  update({
                    url: url ? `${url}\${{ inputs.${input.key} }}` : `\${{ inputs.${input.key} }}`,
                  })
                }
                className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                title={`Click to append \${{ inputs.${input.key} }}`}
              >
                {`\${{ inputs.${input.key} }}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
