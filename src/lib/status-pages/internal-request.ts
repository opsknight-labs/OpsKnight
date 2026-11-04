import { getNextAuthSecret } from '@/lib/secret-manager';

const encoder = new TextEncoder();

async function key() {
  const secret = await getNextAuthSecret();
  if (!secret)
    throw new Error('Internal status routing requires the application authentication secret.');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Web Crypto works in both middleware and Node; no additional secret is required. */
export async function statusDomainRequestHeaders(
  now = Date.now()
): Promise<Record<string, string>> {
  const timestamp = String(now);
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(),
    encoder.encode(`status-domain-map:${timestamp}`)
  );
  return {
    // Explicit agent instead of the runtime default, which WAF bot rules flag
    // when INTERNAL_API_URL points at the WAF-fronted public URL.
    'user-agent': 'OpsKnight-Internal/1.0',
    'x-status-map-time': timestamp,
    'x-status-map-signature': Array.from(new Uint8Array(signature), byte =>
      byte.toString(16).padStart(2, '0')
    ).join(''),
  };
}

export async function verifyStatusDomainRequest(headers: Headers, now = Date.now()) {
  const timestamp = headers.get('x-status-map-time') || '';
  const signature = headers.get('x-status-map-signature') || '';
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 30_000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  try {
    const bytes = Uint8Array.from(signature.match(/.{2}/g) || [], part => parseInt(part, 16));
    return await crypto.subtle.verify(
      'HMAC',
      await key(),
      bytes,
      encoder.encode(`status-domain-map:${timestamp}`)
    );
  } catch {
    return false;
  }
}
