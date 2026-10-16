'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { FormSelect } from '../../RunbookControls';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';
import InputReferenceChips from '../InputReferenceChips';

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
      <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor={`http-method-${editorId}`} className="text-xs">
            Method
          </Label>
          <FormSelect
            name={`http-method-${editorId}`}
            label="HTTP Method"
            value={method}
            disabled={readOnly}
            onValueChange={handleMethodChange}
            options={HTTP_METHODS.map(m => ({ value: m, label: m }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`http-url-${editorId}`} className="text-xs">
            Endpoint URL
          </Label>
          <Input
            id={`http-url-${editorId}`}
            aria-label="URL or input reference"
            placeholder="https://api.internal/health"
            value={url}
            disabled={readOnly}
            onChange={e => update({ url: e.target.value })}
            className={`font-mono text-xs ${errors.url ? 'border-destructive' : ''}`}
          />
          {errors.url ? (
            <p className="text-xs text-destructive">{errors.url}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Absolute URL. Redirects are rejected and output is size-limited.
            </p>
          )}
        </div>
      </div>

      <InputReferenceChips
        inputs={inputs}
        readOnly={readOnly}
        label="Append to URL"
        onInsert={reference => update({ url: `${url}${reference}` })}
      />

      <div className="space-y-1.5">
        <Label htmlFor={`http-headers-${editorId}`} className="text-xs">
          Request headers <span className="font-normal text-muted-foreground">(JSON object)</span>
        </Label>
        <Textarea
          id={`http-headers-${editorId}`}
          aria-label="Request headers"
          disabled={readOnly}
          value={headerText}
          spellCheck={false}
          className="font-mono text-xs"
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
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor={`http-status-${editorId}`} className="text-xs">
          Expected status <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
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
        <p className="text-xs text-muted-foreground">Leave empty to accept any 2xx response.</p>
      </div>

      {!isNoBodyMethod && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`http-body-${editorId}`} className="text-xs">
              Request body
            </Label>
            <span className="text-xs text-muted-foreground">
              {isObjectBody ? 'Structured JSON' : 'JSON or plain text'}
            </span>
          </div>
          <Textarea
            id={`http-body-${editorId}`}
            aria-label="Request body"
            placeholder='{"status": "maintenance"}'
            value={bodyString}
            disabled={readOnly}
            onChange={e => handleBodyChange(e.target.value)}
            className="min-h-24 font-mono text-xs"
            spellCheck={false}
          />
          {errors.body && <p className="text-xs text-destructive">{errors.body}</p>}
        </div>
      )}
    </div>
  );
}
