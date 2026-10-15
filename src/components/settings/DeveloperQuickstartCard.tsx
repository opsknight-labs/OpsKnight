'use client';
/* eslint-disable react-hooks/purity -- performance.now() is an event-handler latency measurement triggered by user click */

import React, { useState } from 'react';
import {
  Terminal,
  Code2,
  Copy,
  Check,
  Play,
  Loader2,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/shadcn/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/shadcn/tabs';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import Link from 'next/link';

interface DeveloperQuickstartCardProps {
  appUrl?: string;
  revealedSecret?: string | null;
  className?: string;
}

type AuthHeaderFormat = 'BEARER' | 'X_API_KEY';
type LanguageType = 'curl' | 'node' | 'python';

interface ScenarioDef {
  id: string;
  badgeNumber: number;
  title: string;
  method: 'GET' | 'POST';
  path: string;
  scope: string;
  description: string;
  payload?: Record<string, unknown>;
  /** Real identifiers the caller must supply; `{name}` in path or payload is replaced. */
  params?: Array<{ name: string; label: string; placeholder: string }>;
  expectedStatus: number;
  expectedResponse: Record<string, unknown>;
}

const SCENARIOS: ScenarioDef[] = [
  {
    id: 'events',
    badgeNumber: 1,
    title: '1. Trigger / Ingest Alert (POST /api/events)',
    method: 'POST',
    path: '/api/events',
    scope: 'events:write',
    description: 'Ingest monitoring signals, telemetry spikes, or heartbeats into OpsKnight.',
    params: [{ name: 'serviceId', label: 'Service ID', placeholder: 'ID of a service in this workspace' }],
    payload: {
      event_action: 'trigger',
      dedup_key: 'api-gateway-5xx-spike',
      service_id: '{serviceId}',
      payload: {
        summary: '5xx Error Rate > 5% on Production API Gateway',
        source: 'datadog-agent',
        severity: 'critical',
        custom_details: {
          cluster: 'prod-us-east-1',
          error_rate: '7.4%',
        },
      },
    },
    expectedStatus: 202,
    expectedResponse: {
      status: 'success',
      result: {
        action: 'created',
        incidentId: 'inc_9f8d1e2a',
        dedupKey: 'api-gateway-5xx-spike',
        status: 'OPEN',
      },
    },
  },
  {
    id: 'incidents',
    badgeNumber: 2,
    title: '2. Query Active Incidents (GET /api/incidents)',
    method: 'GET',
    path: '/api/incidents?status=OPEN&limit=25',
    scope: 'incidents:read',
    description: 'Query ongoing unresolved operational incidents with pagination.',
    expectedStatus: 200,
    expectedResponse: {
      incidents: [
        {
          id: 'inc_9f8d1e2a',
          title: '5xx Error Rate > 5% on Production API Gateway',
          status: 'OPEN',
          priority: 'P1',
          urgency: 'HIGH',
          createdAt: '2026-10-15T21:30:00Z',
          service: { id: 'srv_prod_api_gateway', name: 'API Gateway' },
        },
      ],
    },
  },
  {
    id: 'sample',
    badgeNumber: 3,
    title: '3. Verify Key Connection (GET /api/sample)',
    method: 'GET',
    path: '/api/sample',
    scope: 'Any valid token',
    description: 'Zero-side-effect test endpoint to verify your API key and inspect credentials.',
    expectedStatus: 200,
    expectedResponse: {
      status: 'success',
      authenticated: true,
      message: 'API Key verified successfully. Your programmatic connection to OpsKnight is working.',
      authMethod: 'Bearer',
      key: {
        id: 'key_prod_ingest',
        name: 'Datadog Ingestion',
        prefix: 'ok_live_d7a',
        scopes: ['events:write', 'incidents:read'],
      },
      timestamp: '2026-10-15T21:35:00.000Z',
    },
  },
  {
    id: 'acknowledge',
    badgeNumber: 4,
    title: '4. Acknowledge Incident (POST /api/v2/incidents/{id}/acknowledge)',
    method: 'POST',
    path: '/api/v2/incidents/{incidentId}/acknowledge',
    scope: 'incidents:write',
    description: 'Acknowledge an operational alert programmatically to halt escalation timeouts.',
    params: [{ name: 'incidentId', label: 'Incident ID', placeholder: 'ID of an open incident' }],
    payload: {
      note: 'On-call engineer actively mitigating gateway error spike.',
    },
    expectedStatus: 200,
    expectedResponse: {
      data: {
        id: 'inc_9f8d1e2a',
        status: 'ACKNOWLEDGED',
        acknowledgedAt: '2026-10-15T21:35:00Z',
      },
    },
  },
  {
    id: 'services',
    badgeNumber: 5,
    title: '5. List Services & Health (GET /api/v2/services)',
    method: 'GET',
    path: '/api/v2/services',
    scope: 'services:read',
    description: 'Inspect operational services, health status, and tier dependencies.',
    expectedStatus: 200,
    expectedResponse: {
      data: [
        {
          id: 'srv_prod_api_gateway',
          name: 'API Gateway',
          status: 'OPERATIONAL',
          tier: 'TIER_1',
        },
      ],
    },
  },
];

export default function DeveloperQuickstartCard({
  appUrl,
  revealedSecret,
  className = '',
}: DeveloperQuickstartCardProps) {
  const [authFormat, setAuthFormat] = useState<AuthHeaderFormat>('BEARER');
  const [activeScenarioId, setActiveScenarioId] = useState<string>('events');
  const [activeTab, setActiveTab] = useState<LanguageType>('curl');
  const [viewMode, setViewMode] = useState<'request' | 'response'>('request');
  const [copied, setCopied] = useState(false);

  // Live test runner state
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: number;
    statusText: string;
    durationMs: number;
    data: unknown;
  } | null>(null);

  const baseUrl = appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://api.opsknight.com';
  // Snippets show a placeholder unless a key was just generated on this page.
  const effectiveToken = revealedSecret || 'ok_live_your_api_key';
  // Live tests need a real key. It lives only in this component's memory: never persisted,
  // never put in a URL, and cleared when the page unloads.
  const [testKeyInput, setTestKeyInput] = useState('');
  const liveKey = testKeyInput.trim() || revealedSecret || '';

  // Identifiers for scenarios that act on a specific resource. Samples show a clear placeholder
  // (never an invented id) until the user enters a real one.
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const fill = (scenario: ScenarioDef, text: string) =>
    (scenario.params ?? []).reduce(
      (out, param) =>
        out.split(`{${param.name}}`).join(
          paramValues[param.name]?.trim() || `YOUR_${param.name.replace(/([A-Z])/g, '_$1').toUpperCase()}`
        ),
      text
    );
  const resolve = (scenario: ScenarioDef) => ({
    path: fill(scenario, scenario.path),
    payload: scenario.payload
      ? (JSON.parse(fill(scenario, JSON.stringify(scenario.payload))) as Record<string, unknown>)
      : undefined,
  });
  const missingParams = (scenario: ScenarioDef) =>
    (scenario.params ?? []).filter(param => !paramValues[param.name]?.trim());

  const activeScenario = SCENARIOS.find(s => s.id === activeScenarioId) ?? SCENARIOS[0];

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard fallback
    }
  };

  const generateCurl = (scenario: ScenarioDef) => {
    const fullUrl = `${baseUrl}${resolve(scenario).path}`;
    const headerLine =
      authFormat === 'BEARER'
        ? `  -H "Authorization: Bearer ${effectiveToken}" \\`
        : `  -H "X-API-Key: ${effectiveToken}" \\`;

    if (scenario.method === 'POST') {
      const payloadString = JSON.stringify(resolve(scenario).payload, null, 2);
      return `curl -X POST ${fullUrl} \\
${headerLine}
  -H "Content-Type: application/json" \\
  -d '${payloadString}'`;
    }

    return `curl -X GET "${fullUrl}" \\
${headerLine.replace(/ \\$/, '')}`;
  };

  const generateNode = (scenario: ScenarioDef) => {
    const fullUrl = `${baseUrl}${resolve(scenario).path}`;
    const headersObj =
      authFormat === 'BEARER'
        ? `    'Authorization': 'Bearer ${effectiveToken}',`
        : `    'X-API-Key': '${effectiveToken}',`;

    if (scenario.method === 'POST') {
      const bodyFormatted = JSON.stringify(resolve(scenario).payload, null, 4).replace(/^/gm, '    ').trim();
      return `const response = await fetch('${fullUrl}', {
  method: 'POST',
  headers: {
${headersObj}
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${bodyFormatted}),
});

const result = await response.json();
console.log(result);`;
    }

    return `const response = await fetch('${fullUrl}', {
  headers: {
${headersObj}
  },
});

const data = await response.json();
console.log(data);`;
  };

  const generatePython = (scenario: ScenarioDef) => {
    const fullUrl = `${baseUrl}${resolve(scenario).path}`;
    const headersPy =
      authFormat === 'BEARER'
        ? `        "Authorization": "Bearer ${effectiveToken}",`
        : `        "X-API-Key": "${effectiveToken}",`;

    if (scenario.method === 'POST') {
      const bodyFormatted = JSON.stringify(resolve(scenario).payload, null, 4)
        .replace(/: true/g, ': True')
        .replace(/: false/g, ': False')
        .replace(/: null/g, ': None')
        .replace(/^/gm, '    ')
        .trim();

      return `import requests

response = requests.post(
    "${fullUrl}",
    headers={
${headersPy}
        "Content-Type": "application/json",
    },
    json=${bodyFormatted},
)

print(response.status_code)
print(response.json())`;
    }

    return `import requests

response = requests.get(
    "${fullUrl}",
    headers={
${headersPy}
    },
)

print(response.status_code)
print(response.json())`;
  };

  const getCodeSnippet = (scenario: ScenarioDef, lang: LanguageType) => {
    switch (lang) {
      case 'curl':
        return generateCurl(scenario);
      case 'node':
        return generateNode(scenario);
      case 'python':
        return generatePython(scenario);
      default:
        return generateCurl(scenario);
    }
  };

  const activeSnippet = getCodeSnippet(activeScenario, activeTab);

  // Success means a 2xx that actually authenticated: /api/sample answers 200 with
  // `authenticated: false` for a bad key, and status 0 marks a request that never completed.
  const resultSucceeded =
    !!testResult &&
    testResult.status >= 200 &&
    testResult.status < 300 &&
    !(
      testResult.data &&
      typeof testResult.data === 'object' &&
      (testResult.data as { data?: { authenticated?: unknown } }).data?.authenticated === false
    ) &&
    !(
      testResult.data &&
      typeof testResult.data === 'object' &&
      (testResult.data as { authenticated?: unknown }).authenticated === false
    );

  // Live test runner execution
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const isMutation = activeScenario.method !== 'GET';

  // Requests that change data need an explicit second click on the inline confirmation.
  const requestLiveTest = () => {
    if (!liveKey || missingParams(activeScenario).length > 0) return;
    if (isMutation) {
      setAwaitingConfirmation(true);
      return;
    }
    void executeLiveTest();
  };

  const executeLiveTest = async () => {
    if (!liveKey || missingParams(activeScenario).length > 0) return;
    setAwaitingConfirmation(false);
    setIsRunningTest(true);
    setTestResult(null);
    const start = performance.now();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authFormat === 'BEARER') {
        headers['Authorization'] = `Bearer ${liveKey}`;
      } else {
        headers['X-API-Key'] = liveKey;
      }

      // Execute request against current origin
      const target = resolve(activeScenario);
      const res = await fetch(target.path, {
        method: activeScenario.method,
        headers,
        body: target.payload ? JSON.stringify(target.payload) : undefined,
      });

      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = { message: 'Non-JSON response received' };
      }

      const durationMs = Math.round(performance.now() - start);
      setTestResult({
        status: res.status,
        statusText: res.statusText || (res.status === 200 ? 'OK' : res.status === 202 ? 'Accepted' : 'Response'),
        durationMs,
        data: json,
      });
    } catch (error) {
      // Report the failure as it is; never substitute the sample response for a real result.
      setTestResult({
        status: 0,
        statusText: 'Network error',
        durationMs: Math.round(performance.now() - start),
        data: { error: error instanceof Error ? error.message : 'The request could not be sent.' },
      });
    } finally {
      setIsRunningTest(false);
    }
  };

  return (
    <Card className={`border-border/80 shadow-xs bg-card overflow-hidden ${className}`}>
      {/* 1. Header with Base URL and API Explorer Link */}
      <CardHeader className="pb-3 border-b border-border/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-sm font-bold">Developer API Quickstart</CardTitle>
                <Badge variant="outline" className="text-[10px] font-mono font-medium text-muted-foreground">
                  {baseUrl}
                </Badge>
                {revealedSecret && (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] font-medium gap-1">
                    <Sparkles className="h-3 w-3" />
                    New Token Active
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs mt-0.5">
                Pass your API key in the standard{' '}
                <code className="text-foreground font-mono font-semibold bg-muted px-1.5 py-0.5 rounded border border-border/50">
                  Authorization: Bearer &lt;TOKEN&gt;
                </code>{' '}
                HTTP header.
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1.5">
              <Link href="/settings/api-keys?tab=explorer">
                API Explorer
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* Live-test credential: kept in memory only */}
        <div className="flex flex-col gap-1.5 rounded-xl border border-border/70 bg-muted/20 p-2.5">
          <label htmlFor="quickstart-live-key" className="text-[11px] font-medium text-foreground">
            API key for live tests
          </label>
          <input
            id="quickstart-live-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={testKeyInput}
            onChange={event => setTestKeyInput(event.target.value)}
            placeholder={revealedSecret ? 'Using the key you just generated' : 'ok_live_…'}
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-describedby="quickstart-live-key-help"
          />
          <p id="quickstart-live-key-help" className="text-[11px] text-muted-foreground">
            Used only for &quot;Run Live Test&quot; requests from this page. It is not saved or shown
            in the code samples. Requests that change data ask for confirmation first.
          </p>
        </div>

        {/* 2. Interactive Header Format Switcher & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 rounded-xl border border-border/70 bg-muted/20">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground text-[11px] font-medium">Header formats supported:</span>
            <div className="inline-flex rounded-lg border border-border/60 bg-background p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => setAuthFormat('BEARER')}
                className={`px-2 py-0.5 text-xs font-mono rounded-md transition-all ${
                  authFormat === 'BEARER'
                    ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Bearer &lt;token&gt;
              </button>
              <button
                type="button"
                onClick={() => setAuthFormat('X_API_KEY')}
                className={`px-2 py-0.5 text-xs font-mono rounded-md transition-all ${
                  authFormat === 'X_API_KEY'
                    ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                X-API-Key
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground">or</span>
            <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
              {authFormat === 'BEARER' ? 'Authorization: Bearer <token>' : 'X-API-Key: <token>'}
            </Badge>
          </div>

          <div className="flex items-center gap-1.5 self-end sm:self-center">
            <Button
              type="button"
              variant={viewMode === 'request' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('request')}
              className="h-7 text-[11px] px-2.5"
            >
              Request Code
            </Button>
            <Button
              type="button"
              variant={viewMode === 'response' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('response')}
              className="h-7 text-[11px] px-2.5"
            >
              Expected Response
            </Button>
          </div>
        </div>

        {/* 3. Scenario Selector Pills */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground text-[11px] uppercase tracking-wider">
              Common Developer Scenarios
            </span>
            <span className="text-[11px] text-muted-foreground">
              Required Scope: <code className="font-mono text-foreground font-medium">{activeScenario.scope}</code>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
            {SCENARIOS.map(sc => {
              const isSelected = sc.id === activeScenarioId;
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => {
                    setActiveScenarioId(sc.id);
                    setTestResult(null);
                    setAwaitingConfirmation(false);
                  }}
                  className={`flex flex-col items-start gap-1 p-2 rounded-lg border text-left transition-all ${
                    isSelected
                      ? 'border-primary/60 bg-primary/10 shadow-2xs ring-1 ring-primary/20'
                      : 'border-border/60 bg-background/80 hover:border-border hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <Badge
                      className={`text-[9px] font-bold px-1 py-0 ${
                        sc.method === 'POST'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                          : 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30'
                      }`}
                    >
                      {sc.method}
                    </Badge>
                    <span className="text-[11px] font-semibold truncate text-foreground">
                      {sc.id === 'events'
                        ? '1. Ingest Alert'
                        : sc.id === 'incidents'
                        ? '2. Incidents'
                        : sc.id === 'sample'
                        ? '3. Sample Ping'
                        : sc.id === 'acknowledge'
                        ? '4. Acknowledge'
                        : '5. Services'}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground truncate w-full font-mono">
                    {sc.path.split('?')[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Active Scenario Title and Details */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground">{activeScenario.title}</span>
            <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
              {activeScenario.method} {activeScenario.path.split('?')[0]}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">{activeScenario.description}</p>
        </div>

        {/* 5. Language Tabs & Code Display */}
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as LanguageType)} className="w-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <TabsList className="h-8 bg-muted/60">
              <TabsTrigger value="curl" className="text-xs gap-1.5 h-7">
                <Terminal className="h-3 w-3" />
                cURL
              </TabsTrigger>
              <TabsTrigger value="node" className="text-xs gap-1.5 h-7">
                <Code2 className="h-3 w-3" />
                Node.js / Fetch
              </TabsTrigger>
              <TabsTrigger value="python" className="text-xs gap-1.5 h-7">
                <Code2 className="h-3 w-3" />
                Python (requests)
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={requestLiveTest}
                disabled={isRunningTest || !liveKey || missingParams(activeScenario).length > 0}
                title={
                  !liveKey
                    ? 'Enter an API key above to run live tests'
                    : missingParams(activeScenario).length > 0
                      ? `Enter ${missingParams(activeScenario)
                          .map(param => param.label)
                          .join(' and ')} to run this test`
                      : undefined
                }
                className="h-7 text-xs gap-1.5 border-primary/30 hover:bg-primary/5 text-primary"
              >
                {isRunningTest ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Executing...
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3 fill-current" />
                    Run Live Test
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  handleCopy(
                    viewMode === 'request'
                      ? activeSnippet
                      : JSON.stringify(activeScenario.expectedResponse, null, 2)
                  )
                }
                className="h-7 text-xs gap-1.5"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>

          {/* Snippet Card */}
          <div className="relative rounded-xl bg-muted/40 border border-border/80 p-3.5 font-mono text-xs overflow-x-auto text-foreground">
            {viewMode === 'request' ? (
              <>
                {/* cURL */}
                <TabsContent value="curl" className="m-0">
                  <pre className="leading-relaxed whitespace-pre-wrap">{generateCurl(activeScenario)}</pre>
                </TabsContent>

                {/* Node.js */}
                <TabsContent value="node" className="m-0">
                  <pre className="leading-relaxed whitespace-pre-wrap">{generateNode(activeScenario)}</pre>
                </TabsContent>

                {/* Python */}
                <TabsContent value="python" className="m-0">
                  <pre className="leading-relaxed whitespace-pre-wrap">{generatePython(activeScenario)}</pre>
                </TabsContent>
              </>
            ) : (
              <div>
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/50 text-[11px] text-muted-foreground">
                  <span>Expected Status:</span>
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]"
                  >
                    HTTP {activeScenario.expectedStatus}{' '}
                    {activeScenario.expectedStatus === 202 ? 'Accepted' : 'OK'}
                  </Badge>
                </div>
                <pre className="leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(activeScenario.expectedResponse, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </Tabs>

        {/* 5. Live Test Result Drawer (Shows actual runtime test output) */}
        {awaitingConfirmation && (
          <div
            role="alertdialog"
            aria-labelledby="quickstart-confirm-title"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3"
          >
            <p id="quickstart-confirm-title" className="text-xs text-foreground">
              <span className="font-mono font-semibold">
                {activeScenario.method} {resolve(activeScenario).path}
              </span>{' '}
              sends a real request that changes data in this workspace.
            </p>
            <div className="flex gap-2 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setAwaitingConfirmation(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void executeLiveTest()}
              >
                Send request
              </Button>
            </div>
          </div>
        )}

        {activeScenario.params && activeScenario.params.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 rounded-xl border border-border/70 bg-muted/20 p-2.5">
            {activeScenario.params.map(param => (
              <label key={param.name} className="flex flex-col gap-1 text-[11px] font-medium">
                {param.label} (required for live test)
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={paramValues[param.name] ?? ''}
                  onChange={event =>
                    setParamValues(prev => ({ ...prev, [param.name]: event.target.value }))
                  }
                  placeholder={param.placeholder}
                  className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            ))}
          </div>
        )}

        {testResult && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 space-y-2 animate-in fade-in-50 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    resultSucceeded
                      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 text-[10px]'
                      : 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40 text-[10px]'
                  }
                >
                  {testResult.status === 0
                    ? 'Request failed'
                    : `HTTP ${testResult.status} ${testResult.statusText}`}
                  {testResult.status !== 0 && !resultSucceeded && testResult.status < 300
                    ? ' · not authenticated'
                    : ''}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  Latency: <span className="font-semibold text-foreground">{testResult.durationMs}ms</span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Route: <code className="font-mono text-foreground">{resolve(activeScenario).path}</code>
                </span>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTestResult(null)}
                className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
              >
                Close
              </Button>
            </div>

            <div className="rounded-lg bg-background/90 border border-border/60 p-2.5 font-mono text-xs overflow-x-auto">
              <pre className="text-foreground text-[11px] leading-relaxed">
                {JSON.stringify(testResult.data, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
