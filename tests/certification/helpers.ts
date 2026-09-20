import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import JSZip from 'jszip';

export const CERT_APP_URL = process.env.CERTIFICATION_APP_URL || 'http://localhost:3000';
export const CERT_MAILPIT_URL = process.env.CERTIFICATION_MAILPIT_URL || 'http://localhost:8025';

export const certPrisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ||
        'postgresql://opsknight:opsknight_secure_password_change_me@127.0.0.1:5432/opsknight_db',
    },
  },
});

export interface MailpitMessage {
  ID: string;
  MessageID: string;
  From: { Address: string; Name: string };
  To: Array<{ Address: string; Name: string }>;
  Subject: string;
  Created: string;
  Snippet: string;
  Size: number;
}

export interface MailpitDetailedMessage {
  ID: string;
  Subject: string;
  From: { Address: string; Name: string };
  To: Array<{ Address: string; Name: string }>;
  Text: string;
  HTML: string;
  Headers: Record<string, string[]>;
}

/**
 * Fetch messages from the Mailpit test mailcatcher API.
 */
export async function getMailpitMessages(): Promise<MailpitMessage[]> {
  try {
    const res = await fetch(`${CERT_MAILPIT_URL}/api/v1/messages`);
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: MailpitMessage[] };
    return data.messages || [];
  } catch {
    return [];
  }
}

/**
 * Fetch a single message with body details from Mailpit.
 */
export async function getMailpitMessage(id: string): Promise<MailpitDetailedMessage | null> {
  try {
    const res = await fetch(`${CERT_MAILPIT_URL}/api/v1/message/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as MailpitDetailedMessage;
  } catch {
    return null;
  }
}

/**
 * Clear all emails in Mailpit.
 */
export async function clearMailpitMessages(): Promise<void> {
  try {
    await fetch(`${CERT_MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
  } catch {
    // ignore
  }
}

/**
 * Poll Mailpit until an email matching the subject arrives or timeout expires.
 */
export async function waitForEmail(
  predicate: (msg: MailpitMessage) => boolean,
  timeoutMs = 15000,
  pollIntervalMs = 500
): Promise<MailpitMessage> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = await getMailpitMessages();
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Timed out waiting for matching email after ${timeoutMs}ms`);
}

/**
 * Inspect and cryptographically verify an audit evidence export package ZIP.
 */
export async function verifyAuditPackageZip(buffer: Buffer): Promise<{
  valid: boolean;
  manifest: Record<string, unknown>;
  fileCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const zip = await JSZip.loadAsync(buffer);

  // 1. Check manifest.json
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    errors.push('Missing manifest.json');
    return { valid: false, manifest: {}, fileCount: 0, errors };
  }

  const manifestContent = await manifestFile.async('text');
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(manifestContent);
  } catch (e) {
    errors.push(`Invalid manifest.json JSON: ${(e as Error).message}`);
  }

  // 2. Prohibited phrases check in manifest & README
  const prohibitedRegex =
    /compliance\s+score|readiness\s*%|readiness\s+percent|guarantee\s+compliance|certifies\s+compliance/i;
  if (prohibitedRegex.test(manifestContent)) {
    errors.push('Manifest contains prohibited certification language');
  }

  const readmeFile = zip.file('README.md');
  if (readmeFile) {
    const readmeText = await readmeFile.async('text');
    if (!readmeText.includes('do not constitute legal advice, certification, audit opinion')) {
      errors.push('README is missing mandatory legal non-certification disclaimer');
    }
  }

  // 3. Verify sha256sums.txt
  const checksumFile = zip.file('integrity/sha256sums.txt') || zip.file('sha256sums.txt');
  if (!checksumFile) {
    errors.push('Missing integrity/sha256sums.txt');
  } else {
    const checksumText = await checksumFile.async('text');
    const lines = checksumText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const [expectedHash, filePath] = line.split(/\s+/);
      if (!expectedHash || !filePath) continue;
      const file = zip.file(filePath);
      if (!file) {
        errors.push(`sha256sums.txt lists missing file: ${filePath}`);
        continue;
      }
      const content = await file.async('nodebuffer');
      const actualHash = crypto.createHash('sha256').update(content).digest('hex');
      if (actualHash !== expectedHash) {
        errors.push(
          `Integrity mismatch for ${filePath}: expected ${expectedHash}, got ${actualHash}`
        );
      }
    }
  }

  let fileCount = 0;
  zip.forEach(() => {
    fileCount += 1;
  });

  return {
    valid: errors.length === 0,
    manifest,
    fileCount,
    errors,
  };
}
