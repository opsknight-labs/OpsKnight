import { X509Certificate, verify } from 'crypto';

export interface SnsEnvelope {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Timestamp: string;
  SignatureVersion: '1' | '2';
  Signature: string;
  SigningCertURL: string;
  Message: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

const MAX_CERT_BYTES = 32 * 1024;
const CERT_CACHE_MS = 60 * 60 * 1000;
const certCache = new Map<string, { pem: string; expiresAt: number }>();

export function trustedSnsUrl(raw: string, purpose: 'certificate' | 'subscription'): URL {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    (purpose === 'certificate' && url.search)
  ) {
    throw new Error('Untrusted SNS URL');
  }
  const host = url.hostname.toLowerCase();
  if (!/^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(host)) {
    throw new Error('Untrusted SNS host');
  }
  if (
    purpose === 'certificate' &&
    !/^\/SimpleNotificationService-[A-Fa-f0-9]+\.pem$/.test(url.pathname)
  ) {
    throw new Error('Untrusted SNS certificate path');
  }
  return url;
}

export function canonicalSnsMessage(message: SnsEnvelope): string {
  const fields =
    message.Type === 'Notification'
      ? [
          'Message',
          'MessageId',
          ...(message.Subject ? ['Subject'] : []),
          'Timestamp',
          'TopicArn',
          'Type',
        ]
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields
    .map(field => {
      const value = message[field as keyof SnsEnvelope];
      if (typeof value !== 'string') throw new Error(`Missing SNS field: ${field}`);
      return `${field}\n${value}\n`;
    })
    .join('');
}

export function verifySnsMessageWithPem(message: SnsEnvelope, pem: string): boolean {
  const signature = Buffer.from(message.Signature, 'base64');
  if (
    !signature.length ||
    signature.toString('base64').replace(/=+$/, '') !== message.Signature.replace(/=+$/, '')
  ) {
    return false;
  }
  return verify(
    message.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256',
    Buffer.from(canonicalSnsMessage(message)),
    pem,
    signature
  );
}

async function loadSigningCertificate(rawUrl: string): Promise<string> {
  const url = trustedSnsUrl(rawUrl, 'certificate').toString();
  const cached = certCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(5_000),
    redirect: 'error',
    headers: { accept: 'application/x-pem-file,text/plain' },
  });
  if (!response.ok) throw new Error(`SNS certificate fetch failed (${response.status})`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_CERT_BYTES) throw new Error('SNS certificate is too large');
  const pem = await response.text();
  if (Buffer.byteLength(pem) > MAX_CERT_BYTES) throw new Error('SNS certificate is too large');

  const certificate = new X509Certificate(pem);
  const now = Date.now();
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now) {
    throw new Error('SNS signing certificate is not currently valid');
  }
  certCache.set(url, {
    pem,
    expiresAt: Math.min(now + CERT_CACHE_MS, Date.parse(certificate.validTo)),
  });
  return pem;
}

export async function verifySnsMessage(
  message: SnsEnvelope,
  expectedTopicArn: string
): Promise<void> {
  if (message.TopicArn !== expectedTopicArn)
    throw new Error('SNS topic does not match integration');
  if (Math.abs(Date.now() - Date.parse(message.Timestamp)) > 15 * 60 * 1000) {
    throw new Error('SNS message timestamp is outside the accepted window');
  }
  const pem = await loadSigningCertificate(message.SigningCertURL);
  if (!verifySnsMessageWithPem(message, pem)) throw new Error('Invalid SNS signature');
}
