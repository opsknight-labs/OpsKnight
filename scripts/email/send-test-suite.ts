/**
 * Renders every OpsKnight email template from its preview fixture and either writes the
 * HTML to disk or sends the full set over SMTP, for checking real clients
 * (Outlook desktop / new Outlook / Gmail web + apps / Apple Mail; light + dark).
 *
 *   # Local inbox (Mailpit: docker compose -f deploy/compose/docker-compose.mailpit.yml up -d)
 *   npm run email:send-test -- --to you@example.com
 *   open http://localhost:8025   # HTML check, link check, spam score, raw source
 *
 *   # Real inboxes through any SMTP server (e.g. a Gmail app password)
 *   SMTP_USER=you@gmail.com SMTP_PASS=app-password \
 *     npm run email:send-test -- --smtp smtp.gmail.com:587 --to you@gmail.com,you@outlook.com
 *
 *   # Just write the rendered HTML + text files
 *   npm run email:send-test -- --out ./tmp/emails
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import nodemailer from 'nodemailer';
import { renderEmail } from '@/emails/render';

type TemplateModule = {
  default: ComponentType<Record<string, unknown>> & { PreviewProps?: Record<string, unknown> };
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const to = arg('to')?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  const out = arg('out');
  const [host, port] = (arg('smtp') ?? 'localhost:1025').split(':');
  const from = arg('from') ?? 'OpsKnight Email QA <qa@opsknight.local>';
  if (!to.length && !out) {
    console.error('Pass --to <addresses> and/or --out <dir>.');
    process.exit(1);
  }

  const dir = resolve(__dirname, '../../src/emails/templates');
  const files = readdirSync(dir).filter(file => file.endsWith('.tsx')).sort();
  const transport = to.length
    ? nodemailer.createTransport({
        host,
        port: Number(port || 1025),
        secure: Number(port) === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
          : undefined,
      })
    : null;

  if (out) mkdirSync(out, { recursive: true });

  for (const file of files) {
    const name = basename(file, '.tsx');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(join(dir, file)) as TemplateModule;
    const { html, text } = await renderEmail(
      createElement(mod.default, mod.default.PreviewProps ?? {})
    );
    const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
    if (out) {
      writeFileSync(join(out, `${name}.html`), html);
      writeFileSync(join(out, `${name}.txt`), text);
    }
    if (transport) {
      await transport.sendMail({ from, to, subject: `[OpsKnight QA] ${name}`, html, text });
    }
    console.log(`✓ ${name.padEnd(22)} ${kb.padStart(5)} KB${transport ? ` → ${to.join(', ')}` : ''}`);
  }
  transport?.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
