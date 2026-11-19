import { describe, expect, it } from 'vitest';
import {
  formatSlackPayload,
  formatTelegramPayload,
  generateIncidentWebhookPayload,
} from '@/lib/webhooks';

const incident = {
  id: 'inc-1',
  title: 'Database outage',
  description: 'x'.repeat(10_000),
  status: 'OPEN',
  urgency: 'HIGH',
  service: { id: 'svc-1', name: 'API' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('webhook payload provider limits', () => {
  it('keeps Telegram text under 4096 characters for a maximum-length description', () => {
    const payload = formatTelegramPayload(incident, 'triggered', 'https://ops.example.com', '123');
    expect(payload.text.length).toBeLessThanOrEqual(4096);
  });

  it('keeps every Slack section under 3000 characters', () => {
    const payload = formatSlackPayload(incident, 'triggered', 'https://ops.example.com');
    for (const block of payload.blocks as Array<{ text?: { text: string } }>) {
      if (block.text) expect(block.text.text.length).toBeLessThanOrEqual(3000);
    }
  });

  it('labels SLA breaches distinctly from new incidents', () => {
    expect(generateIncidentWebhookPayload(incident, 'breached').event.type).toBe('breached');
  });
});
