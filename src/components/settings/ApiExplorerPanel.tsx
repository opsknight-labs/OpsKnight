'use client';

import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/shadcn/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import CopyButton from './CopyButton';
import {
  Code2,
  Terminal,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Shield,
} from 'lucide-react';

export type ApiEndpointDoc = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  tag: string;
  summary: string;
  description: string;
  scope?: string;
  parameters?: {
    name: string;
    in: 'path' | 'query' | 'header';
    required?: boolean;
    description?: string;
  }[];
  requestBody?: {
    description?: string;
    sample?: Record<string, unknown> | string;
  };
};

const METHOD_STYLES = {
  GET: {
    badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
    border: 'border-l-blue-500',
  },
  POST: {
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    border: 'border-l-emerald-500',
  },
  PATCH: {
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    border: 'border-l-amber-500',
  },
  PUT: {
    badge: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
    border: 'border-l-indigo-500',
  },
  DELETE: {
    badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
    border: 'border-l-rose-500',
  },
};

export default function ApiExplorerPanel({
  endpoints,
  appUrl,
}: {
  endpoints: ApiEndpointDoc[];
  appUrl?: string;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('ALL');
  const [selectedMethod, setSelectedMethod] = useState('ALL');
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(new Set());

  const baseUrl = appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://api.opsknight.com';

  const tags = useMemo(() => {
    const set = new Set<string>();
    endpoints.forEach(e => set.add(e.tag));
    return Array.from(set).sort();
  }, [endpoints]);

  const filteredEndpoints = useMemo(() => {
    return endpoints.filter(endpoint => {
      const matchesSearch =
        searchQuery === '' ||
        endpoint.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        endpoint.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        endpoint.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTag = selectedTag === 'ALL' || endpoint.tag === selectedTag;
      const matchesMethod = selectedMethod === 'ALL' || endpoint.method === selectedMethod;
      return matchesSearch && matchesTag && matchesMethod;
    });
  }, [endpoints, searchQuery, selectedTag, selectedMethod]);

  const toggleEndpoint = (key: string) => {
    setExpandedEndpoints(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedEndpoints(new Set(filteredEndpoints.map(e => `${e.method}:${e.path}`)));
  };

  const collapseAll = () => {
    setExpandedEndpoints(new Set());
  };

  function toPythonLiteral(value: unknown, indent = 0): string {
    const pad = ' '.repeat(indent);
    if (value === null) return 'None';
    if (value === true) return 'True';
    if (value === false) return 'False';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const items = value
        .map(item => `${pad}    ${toPythonLiteral(item, indent + 4)}`)
        .join(',\n');
      return `[\n${items},\n${pad}]`;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return '{}';
      const lines = entries
        .map(([k, v]) => `${pad}    ${JSON.stringify(k)}: ${toPythonLiteral(v, indent + 4)}`)
        .join(',\n');
      return `{\n${lines},\n${pad}}`;
    }
    return String(value);
  }

  const getCurlSnippet = (ep: ApiEndpointDoc) => {
    const fullUrl = `${baseUrl}/api/v2${ep.path}`;
    const hasRequiredIdempotency =
      ep.parameters?.some(p => p.name.toLowerCase() === 'idempotency-key' && p.required) ||
      ep.path === '/runbooks/{id}/execute';

    let snippet = `curl -X ${ep.method} "${fullUrl}" \\\n  -H "Authorization: Bearer ok_live_your_api_key"`;
    if (hasRequiredIdempotency) {
      snippet += ` \\\n  -H "Idempotency-Key: idem_live_unique_key"`;
    }
    if (ep.method === 'POST' || ep.method === 'PATCH' || ep.method === 'PUT') {
      snippet += ` \\\n  -H "Content-Type: application/json"`;
      if (ep.requestBody?.sample) {
        snippet += ` \\\n  -d '${typeof ep.requestBody.sample === 'string' ? ep.requestBody.sample : JSON.stringify(ep.requestBody.sample, null, 2)}'`;
      }
    }
    return snippet;
  };

  const getJsSnippet = (ep: ApiEndpointDoc) => {
    const fullUrl = `${baseUrl}/api/v2${ep.path}`;
    const hasBody = ep.method === 'POST' || ep.method === 'PATCH' || ep.method === 'PUT';
    const hasRequiredIdempotency =
      ep.parameters?.some(p => p.name.toLowerCase() === 'idempotency-key' && p.required) ||
      ep.path === '/runbooks/{id}/execute';

    const headerLines = [
      "    'Authorization': 'Bearer ok_live_your_api_key',",
      hasRequiredIdempotency ? "    'Idempotency-Key': 'idem_live_unique_key'," : null,
      hasBody ? "    'Content-Type': 'application/json'," : null,
    ].filter(Boolean).join('\n');

    const responseHandling =
      ep.method === 'DELETE'
        ? `if (response.status === 204) {
  console.log('Success (204 No Content)');
} else {
  const data = await response.json();
  console.log(data);
}`
        : `const data = await response.json();
console.log(data);`;

    return `const response = await fetch('${fullUrl}', {
  method: '${ep.method}',
  headers: {
${headerLines}
  },${hasBody && ep.requestBody?.sample ? `\n  body: JSON.stringify(${JSON.stringify(ep.requestBody.sample, null, 2)}),` : ''}
});

${responseHandling}`;
  };

  const getPythonSnippet = (ep: ApiEndpointDoc) => {
    const fullUrl = `${baseUrl}/api/v2${ep.path}`;
    const methodLower = ep.method.toLowerCase();
    const hasBody = ep.method === 'POST' || ep.method === 'PATCH' || ep.method === 'PUT';
    const hasRequiredIdempotency =
      ep.parameters?.some(p => p.name.toLowerCase() === 'idempotency-key' && p.required) ||
      ep.path === '/runbooks/{id}/execute';

    const pythonHeaders = [
      '        "Authorization": "Bearer ok_live_your_api_key",',
      hasRequiredIdempotency ? '        "Idempotency-Key": "idem_live_unique_key",' : null,
    ].filter(Boolean).join('\n');

    const pythonBody = hasBody && ep.requestBody?.sample ? toPythonLiteral(ep.requestBody.sample, 0) : null;

    const pythonResponseHandling =
      ep.method === 'DELETE'
        ? `if response.status_code == 204:
    print("Success (204 No Content)")
else:
    print(response.json())`
        : `print(response.json())`;

    if (pythonBody) {
      return `import requests

url = "${fullUrl}"
headers = {
${pythonHeaders}
}
payload = ${pythonBody}

response = requests.${methodLower}(url, headers=headers, json=payload)
${pythonResponseHandling}`;
    }

    return `import requests

url = "${fullUrl}"
headers = {
${pythonHeaders}
}

response = requests.${methodLower}(url, headers=headers)
${pythonResponseHandling}`;
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 bg-card border border-border/80 p-3.5 rounded-2xl shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search endpoints by path or keyword..."
              className="h-9 text-xs pl-8 bg-background"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select value={selectedTag} onValueChange={setSelectedTag}>
            <SelectTrigger className="h-9 text-xs w-[160px] bg-background">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Categories ({tags.length})</SelectItem>
              {tags.map(t => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedMethod} onValueChange={setSelectedMethod}>
            <SelectTrigger className="h-9 text-xs w-[120px] bg-background">
              <SelectValue placeholder="All Methods" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Methods</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PATCH">PATCH</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={expandAll} className="h-9 text-xs">
            Expand All
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll} className="h-9 text-xs">
            Collapse All
          </Button>
        </div>
      </div>

      {/* 2. Endpoint Count Info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          Showing <strong className="text-foreground">{filteredEndpoints.length}</strong> of{' '}
          <strong className="text-foreground">{endpoints.length}</strong> REST v2 endpoints
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] bg-muted px-2 py-0.5 rounded border border-border/60">
            Base: {baseUrl}/api/v2
          </span>
        </div>
      </div>

      {/* 3. Endpoints List */}
      <div className="space-y-3">
        {filteredEndpoints.map(endpoint => {
          const key = `${endpoint.method}:${endpoint.path}`;
          const isExpanded = expandedEndpoints.has(key);
          const methodStyle = METHOD_STYLES[endpoint.method] || METHOD_STYLES.GET;

          return (
            <Card
              key={key}
              className={`border-border/80 shadow-xs overflow-hidden border-l-4 ${methodStyle.border}`}
            >
              <div
                onClick={() => toggleEndpoint(key)}
                className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Badge
                    variant="outline"
                    className={`font-mono font-bold text-xs px-2 py-0.5 shrink-0 ${methodStyle.badge}`}
                  >
                    {endpoint.method}
                  </Badge>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono font-bold text-foreground">
                        /api/v2{endpoint.path}
                      </code>
                      <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                        {endpoint.tag}
                      </Badge>
                      {endpoint.scope && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                          <Shield className="h-2.5 w-2.5" />
                          {endpoint.scope}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{endpoint.summary}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-border/60 bg-muted/10 p-4 sm:p-5 space-y-4">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground mb-1">Description</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {endpoint.description}
                    </p>
                  </div>

                  {endpoint.parameters && endpoint.parameters.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-foreground mb-2">Parameters</h4>
                      <div className="overflow-x-auto rounded-lg border border-border/60 bg-background">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-muted/40 border-b border-border/60">
                            <tr>
                              <th className="py-2 px-3 font-semibold text-muted-foreground">Parameter</th>
                              <th className="py-2 px-3 font-semibold text-muted-foreground">Type</th>
                              <th className="py-2 px-3 font-semibold text-muted-foreground">Required</th>
                              <th className="py-2 px-3 font-semibold text-muted-foreground">Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {endpoint.parameters.map(param => (
                              <tr key={param.name} className="border-b border-border/40 last:border-0">
                                <td className="py-2 px-3 font-mono font-bold text-foreground">
                                  {param.name}
                                </td>
                                <td className="py-2 px-3 text-muted-foreground">{param.in}</td>
                                <td className="py-2 px-3">
                                  {param.required ? (
                                    <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 border-rose-500/20">
                                      Required
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">Optional</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-muted-foreground">{param.description || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Code Request Generator */}
                  <div>
                    <h4 className="text-xs font-semibold text-foreground mb-2">Example Request</h4>
                    <Tabs defaultValue="curl" className="w-full">
                      <TabsList className="h-8 bg-muted/60 mb-2">
                        <TabsTrigger value="curl" className="text-xs gap-1.5 py-1">
                          <Terminal className="h-3 w-3" />
                          cURL
                        </TabsTrigger>
                        <TabsTrigger value="node" className="text-xs gap-1.5 py-1">
                          <Code2 className="h-3 w-3" />
                          JavaScript
                        </TabsTrigger>
                        <TabsTrigger value="python" className="text-xs gap-1.5 py-1">
                          <Code2 className="h-3 w-3" />
                          Python
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="curl" className="relative">
                        <div className="rounded-xl bg-muted/40 border border-border/80 p-3 font-mono text-xs overflow-x-auto text-foreground">
                          <pre>{getCurlSnippet(endpoint)}</pre>
                        </div>
                        <div className="absolute right-2 top-2">
                          <CopyButton text={getCurlSnippet(endpoint)} />
                        </div>
                      </TabsContent>

                      <TabsContent value="node" className="relative">
                        <div className="rounded-xl bg-muted/40 border border-border/80 p-3 font-mono text-xs overflow-x-auto text-foreground">
                          <pre>{getJsSnippet(endpoint)}</pre>
                        </div>
                        <div className="absolute right-2 top-2">
                          <CopyButton text={getJsSnippet(endpoint)} />
                        </div>
                      </TabsContent>

                      <TabsContent value="python" className="relative">
                        <div className="rounded-xl bg-muted/40 border border-border/80 p-3 font-mono text-xs overflow-x-auto text-foreground">
                          <pre>{getPythonSnippet(endpoint)}</pre>
                        </div>
                        <div className="absolute right-2 top-2">
                          <CopyButton text={getPythonSnippet(endpoint)} />
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
