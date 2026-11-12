// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { MCP_APP_VIEWS, REVIEW_BASE_PLACEHOLDER } from '@/lib/mcp/protocol/app-widgets';

type Sent = { id?: number; method?: string; params?: Record<string, unknown> };

/** Loads a view as a host would and captures what it posts to its parent. */
function mount(html: string) {
  const sent: Sent[] = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    beforeParse(window) {
      window.postMessage = ((message: Sent) => sent.push(message)) as typeof window.postMessage;
      Object.defineProperty(window, 'crypto', { value: globalThis.crypto });
    },
  });
  const window = dom.window;
  const deliver = (data: unknown) =>
    window.dispatchEvent(new window.MessageEvent('message', { data, source: window }));
  const result = (structuredContent: unknown) =>
    deliver({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { structuredContent },
    });
  return { window, sent, deliver, result };
}

const XSS = '<img src=x onerror="window.__pwned=1">';

describe('MCP Apps views', () => {
  it('are self-contained with a strict CSP and no network or external script', () => {
    for (const view of Object.values(MCP_APP_VIEWS)) {
      expect(view.html).toContain('http-equiv="Content-Security-Policy"');
      expect(view.html).toContain("default-src 'none'");
      expect(view.html).toContain("connect-src 'none'");
      expect(view.html).not.toMatch(
        /<script[^>]+src=|<link[^>]+href=|fetch\(|XMLHttpRequest|WebSocket|innerHTML|outerHTML|insertAdjacentHTML|document\.write/
      );
    }
  });

  it('performs the ui/initialize handshake with the host', () => {
    const { sent, deliver } = mount(MCP_APP_VIEWS.incident.html);
    expect(sent[0]).toMatchObject({
      method: 'ui/initialize',
      params: { protocolVersion: '2026-01-26' },
    });
    deliver({ jsonrpc: '2.0', id: sent[0].id, result: {} });
    return new Promise(resolve => setTimeout(resolve, 0)).then(() =>
      expect(sent.map(m => m.method)).toContain('ui/notifications/initialized')
    );
  });

  it('renders a malicious incident title as text', () => {
    const { window, result } = mount(MCP_APP_VIEWS.incident.html);
    result({ data: { data: { id: 'inc1', title: XSS, status: 'OPEN', urgency: 'HIGH' } } });
    expect(window.document.querySelector('h1')?.textContent).toBe(XSS);
    expect(window.document.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('acknowledges by asking the host to call the existing tool', () => {
    const { window, sent, result } = mount(MCP_APP_VIEWS.incident.html);
    result({ data: { data: { id: 'inc1', title: 'Disk full', status: 'OPEN' } } });
    const ack = [...window.document.querySelectorAll('button')].find(
      b => b.textContent === 'Acknowledge'
    )!;
    ack.click();
    const call = sent.find(m => m.method === 'tools/call');
    expect(call?.params).toMatchObject({
      name: 'incident_acknowledge',
      arguments: { path: { id: 'inc1' } },
    });
    expect((call?.params?.arguments as { idempotencyKey: string }).idempotencyKey).toMatch(
      /^[A-Za-z0-9_-]{16,128}$/
    );
  });

  it('ignores messages that do not come from the host', () => {
    const { window } = mount(MCP_APP_VIEWS.incident.html);
    const other = new JSDOM('').window;
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: { structuredContent: { data: { data: { id: 'x', title: 'Spoofed' } } } },
        },
        source: other as unknown as Window,
      })
    );
    expect(window.document.querySelector('h1')).toBeNull();
  });

  it('lists who is on call as text', () => {
    const { window, result } = mount(MCP_APP_VIEWS.oncall.html);
    result({
      data: {
        data: {
          schedules: [
            {
              scheduleName: 'Primary',
              onCall: [{ userId: 'u1', name: XSS, end: '2026-11-12T18:00:00Z' }],
            },
            { scheduleName: XSS, onCall: [], gap: true },
          ],
        },
      },
    });
    const items = [...window.document.querySelectorAll('li')].map(li => li.textContent);
    expect(items[0]).toContain(XSS);
    expect(items[1]).toContain('gap');
    expect(window.document.querySelector('img')).toBeNull();
  });

  it('shows approval status and a review link, and can neither approve nor reject', () => {
    const { window, sent, result } = mount(MCP_APP_VIEWS.approval.html);
    result({
      status: 'PENDING',
      approvalId: 'ap1',
      summary: XSS,
      reviewUrl: 'https://ops.example.com/mcp/approvals/ap1',
    });
    const text = window.document.body.textContent ?? '';
    expect(text).toContain('PENDING');
    expect(window.document.querySelector('img')).toBeNull();
    const buttons = [...window.document.querySelectorAll('button')];
    expect(buttons.map(b => b.textContent)).toEqual(['Open review page']);
    buttons[0].click();
    expect(sent.at(-1)).toMatchObject({
      method: 'ui/open-link',
      params: { url: 'https://ops.example.com/mcp/approvals/ap1' },
    });
    // The view's source has no way to decide: no tool call and no approve/reject wording.
    expect(MCP_APP_VIEWS.approval.html).not.toMatch(
      /tools\/call'|callTool\(|commit|approve\(|reject\(/i
    );
    expect(sent.some(m => m.method === 'tools/call')).toBe(false);
  });

  it('links to the review page on the server origin it was served with', () => {
    const html = MCP_APP_VIEWS.approval.html.replace(
      REVIEW_BASE_PLACEHOLDER,
      JSON.stringify('https://ops.example.com')
    );
    const { window, sent, result } = mount(html);
    // operation_get_approval carries no reviewUrl; the link is built from the approval id.
    result({
      data: { data: { approvalId: 'ap2', status: 'APPROVED', operationId: 'assignIncident' } },
    });
    window.document.querySelector('button')!.click();
    expect(sent.at(-1)?.params).toEqual({
      url: 'https://ops.example.com/settings/integrations/mcp/approvals/operations/ap2',
    });
  });

  it('refuses a non-http review link', () => {
    const { window, result } = mount(MCP_APP_VIEWS.approval.html);
    result({ status: 'PENDING', reviewUrl: 'javascript:alert(1)' });
    expect(window.document.querySelectorAll('button')).toHaveLength(0);
  });
});
