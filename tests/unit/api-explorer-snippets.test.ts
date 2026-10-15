import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';
import { getVerifiedSampleBody } from '@/lib/api-v2/endpoint-samples';
import {
  getCurlSnippet,
  getJsSnippet,
  getPythonSnippet,
  getSamplePath,
  type ApiEndpointDoc,
} from '@/components/settings/ApiExplorerPanel';

describe('API Explorer Snippet Generator Verification', () => {
  it('covers all 63 registered REST v2 operations', () => {
    expect(V2_OPERATIONS).toHaveLength(63);
  });

  describe('Path Parameter Resolution', () => {
    for (const op of V2_OPERATIONS) {
      it(`resolves all URL template variables for ${op.method.toUpperCase()} ${op.path}`, () => {
        const resolved = getSamplePath(op.path, op.method.toUpperCase());
        // Must not leave any raw {id}, {tokenId}, or {xyz} in the resolved path
        expect(resolved).not.toMatch(/\{[a-zA-Z0-9_-]+\}/);
        expect(resolved.startsWith('/')).toBe(true);

        if (op.path.includes('{id}')) {
          expect(resolved).toMatch(/_(123456|[a-z0-9]+)/);
        }
      });
    }
  });

  describe('cURL Snippet Verification', () => {
    for (const op of V2_OPERATIONS) {
      const endpointKey = `${op.method.toUpperCase()} ${op.path}`;
      const sample = getVerifiedSampleBody(op.method, op.path);
      const epDoc: ApiEndpointDoc = {
        method: op.method.toUpperCase() as ApiEndpointDoc['method'],
        path: op.path,
        tag: 'Test',
        summary: op.operationId,
        description: 'Test description',
        scope: op.scope,
        requestBody: sample ? { sample } : undefined,
      };

      it(`generates valid Bearer cURL snippet for ${endpointKey}`, () => {
        const snippet = getCurlSnippet(epDoc, 'https://api.test.opsknight.com', 'BEARER');
        expect(snippet).toContain(`curl -X ${op.method.toUpperCase()} "https://api.test.opsknight.com/api/v2`);
        expect(snippet).toContain('-H "Authorization: Bearer ok_live_your_api_key"');
        expect(snippet).not.toMatch(/\{[a-zA-Z0-9_-]+\}/);

        if (op.path === '/runbooks/{id}/execute') {
          expect(snippet).toContain('-H "Idempotency-Key: idem_live_unique_key"');
        }

        if (sample) {
          expect(snippet).toContain('-H "Content-Type: application/json"');
          expect(snippet).toContain("-d '");
        }
      });

      it(`generates valid X-API-Key cURL snippet for ${endpointKey}`, () => {
        const snippet = getCurlSnippet(epDoc, 'https://api.test.opsknight.com', 'X_API_KEY');
        expect(snippet).toContain(`curl -X ${op.method.toUpperCase()} "https://api.test.opsknight.com/api/v2`);
        expect(snippet).toContain('-H "X-API-Key: ok_live_your_api_key"');
        expect(snippet).not.toContain('Authorization: Bearer');
      });
    }
  });

  describe('JavaScript (fetch) Snippet Syntax & Structure', () => {
    for (const op of V2_OPERATIONS) {
      const endpointKey = `${op.method.toUpperCase()} ${op.path}`;
      const sample = getVerifiedSampleBody(op.method, op.path);
      const epDoc: ApiEndpointDoc = {
        method: op.method.toUpperCase() as ApiEndpointDoc['method'],
        path: op.path,
        tag: 'Test',
        summary: op.operationId,
        description: 'Test description',
        scope: op.scope,
        requestBody: sample ? { sample } : undefined,
      };

      it(`compiles syntactically valid JavaScript for Bearer ${endpointKey}`, () => {
        const jsCode = getJsSnippet(epDoc, 'https://api.test.opsknight.com', 'BEARER');
        expect(jsCode).toContain("'Authorization': 'Bearer ok_live_your_api_key'");
        expect(jsCode).not.toMatch(/\{[a-zA-Z0-9_-]+\}/);

        if (op.method === 'delete') {
          expect(jsCode).toContain('if (response.status === 204)');
          expect(jsCode).toContain("console.log('Success (204 No Content)');");
        }

        // Verify AST / compilation validity using Node vm.compileFunction
        const wrapped = `async function testRunner() {\n${jsCode}\n}`;
        expect(() => vm.compileFunction(wrapped, ['fetch'])).not.toThrow();
      });

      it(`compiles syntactically valid JavaScript for X-API-Key ${endpointKey}`, () => {
        const jsCode = getJsSnippet(epDoc, 'https://api.test.opsknight.com', 'X_API_KEY');
        expect(jsCode).toContain("'X-API-Key': 'ok_live_your_api_key'");
        expect(jsCode).not.toContain('Authorization');

        const wrapped = `async function testRunner() {\n${jsCode}\n}`;
        expect(() => vm.compileFunction(wrapped, ['fetch'])).not.toThrow();
      });
    }
  });

  describe('Python (requests) Snippet Verification', () => {
    for (const op of V2_OPERATIONS) {
      const endpointKey = `${op.method.toUpperCase()} ${op.path}`;
      const sample = getVerifiedSampleBody(op.method, op.path);
      const epDoc: ApiEndpointDoc = {
        method: op.method.toUpperCase() as ApiEndpointDoc['method'],
        path: op.path,
        tag: 'Test',
        summary: op.operationId,
        description: 'Test description',
        scope: op.scope,
        requestBody: sample ? { sample } : undefined,
      };

      it(`generates valid Python snippet for Bearer ${endpointKey}`, () => {
        const pyCode = getPythonSnippet(epDoc, 'https://api.test.opsknight.com', 'BEARER');
        expect(pyCode).toContain('import requests');
        expect(pyCode).toContain(`response = requests.${op.method.toLowerCase()}(url`);
        expect(pyCode).toContain('"Authorization": "Bearer ok_live_your_api_key"');
        expect(pyCode).not.toMatch(/\{[a-zA-Z0-9_-]+\}/);

        if (op.method === 'delete') {
          expect(pyCode).toContain('if response.status_code == 204:');
          expect(pyCode).toContain('print("Success (204 No Content)")');
        } else {
          expect(pyCode).toContain('print(response.json())');
        }

        if (sample) {
          expect(pyCode).toContain('payload = {');
          expect(pyCode).toContain('json=payload');
        }
      });

      it(`generates valid Python snippet for X-API-Key ${endpointKey}`, () => {
        const pyCode = getPythonSnippet(epDoc, 'https://api.test.opsknight.com', 'X_API_KEY');
        expect(pyCode).toContain('"X-API-Key": "ok_live_your_api_key"');
        expect(pyCode).not.toContain('Authorization');
      });
    }
  });
});
