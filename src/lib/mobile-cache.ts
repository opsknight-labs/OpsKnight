'use client';

import {
  principalStorageSegment,
  readMobilePrincipalContext,
  type MobilePrincipalContext,
} from '@/lib/mobile-principal';

const CACHE_SCHEMA_VERSION = 3;
const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const MOBILE_CACHE_PREFIX = 'opsknight:mobile-cache:';
export const MOBILE_CACHE_KEY_DATABASE = 'opsknight-secure-cache';
const KEY_STORE = 'keys';
const KEY_PREFIX = 'mobile-cache-aes-gcm:';

type CacheEnvelope<T> = {
  schemaVersion: number;
  principalId: string;
  authGeneration: string;
  savedAt: string;
  expiresAt: string;
  data: T;
};

type EncryptedEnvelope = {
  schemaVersion: number;
  principalId: string;
  authGeneration: string;
  savedAt: string;
  expiresAt: string;
  iv: string;
  ciphertext: string;
};

const textEncoder = typeof window !== 'undefined' ? new TextEncoder() : null;
const textDecoder = typeof window !== 'undefined' ? new TextDecoder() : null;
const cryptoKeyPromises = new Map<string, Promise<CryptoKey | null>>();

const base64Encode = (bytes: ArrayBuffer): string => {
  if (typeof window === 'undefined') return '';
  const view = new Uint8Array(bytes);
  const chunks: string[] = [];
  for (let offset = 0; offset < view.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...view.subarray(offset, offset + 0x8000)));
  }
  return window.btoa(chunks.join(''));
};

const base64Decode = (value: string): ArrayBuffer => {
  if (typeof window === 'undefined') return new ArrayBuffer(0);
  const binary = window.atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
};

function storageKey(context: MobilePrincipalContext, key: string) {
  return `${MOBILE_CACHE_PREFIX}${principalStorageSegment(context)}:${key}`;
}

function keyId(context: MobilePrincipalContext) {
  return `${KEY_PREFIX}${principalStorageSegment(context)}`;
}

const getCryptoKey = async (context: MobilePrincipalContext): Promise<CryptoKey | null> => {
  if (typeof window === 'undefined' || !window.crypto?.subtle || !window.indexedDB) return null;
  const id = keyId(context);
  const existing = cryptoKeyPromises.get(id);
  if (existing) return existing;

  const promise = new Promise<CryptoKey | null>(resolve => {
    const request = window.indexedDB.open(MOBILE_CACHE_KEY_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) {
        request.result.createObjectStore(KEY_STORE);
      }
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(id);
      read.onerror = () => {
        database.close();
        resolve(null);
      };
      read.onsuccess = async () => {
        if (read.result instanceof CryptoKey) {
          database.close();
          resolve(read.result);
          return;
        }
        try {
          const key = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
          );
          const write = database
            .transaction(KEY_STORE, 'readwrite')
            .objectStore(KEY_STORE)
            .put(key, id);
          write.onerror = () => {
            database.close();
            resolve(null);
          };
          write.onsuccess = () => {
            database.close();
            resolve(key);
          };
        } catch {
          database.close();
          resolve(null);
        }
      };
    };
  });

  cryptoKeyPromises.set(id, promise);
  return promise;
};

const encryptEnvelope = async <T>(
  envelope: CacheEnvelope<T>,
  context: MobilePrincipalContext
): Promise<EncryptedEnvelope | null> => {
  if (typeof window === 'undefined' || !window.crypto?.subtle || !textEncoder) return null;
  const key = await getCryptoKey(context);
  if (!key) return null;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = textEncoder.encode(JSON.stringify(envelope));
  const ciphertextBuffer = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    schemaVersion: envelope.schemaVersion,
    principalId: envelope.principalId,
    authGeneration: envelope.authGeneration,
    savedAt: envelope.savedAt,
    expiresAt: envelope.expiresAt,
    iv: base64Encode(iv.buffer),
    ciphertext: base64Encode(ciphertextBuffer),
  };
};

const decryptEnvelope = async <T>(
  value: string | null,
  context: MobilePrincipalContext
): Promise<CacheEnvelope<T> | null> => {
  if (!value || typeof window === 'undefined' || !window.crypto?.subtle || !textDecoder) return null;
  let stored: EncryptedEnvelope;
  try {
    stored = JSON.parse(value) as EncryptedEnvelope;
  } catch {
    return null;
  }
  if (
    stored.schemaVersion !== CACHE_SCHEMA_VERSION ||
    stored.principalId !== context.principalId ||
    stored.authGeneration !== context.authGeneration ||
    !stored.iv ||
    !stored.ciphertext ||
    !stored.expiresAt
  ) {
    return null;
  }

  const key = await getCryptoKey(context);
  if (!key) return null;
  try {
    const plaintextBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(base64Decode(stored.iv)) },
      key,
      base64Decode(stored.ciphertext)
    );
    const envelope = JSON.parse(textDecoder.decode(plaintextBuffer)) as CacheEnvelope<T>;
    if (
      envelope.schemaVersion !== CACHE_SCHEMA_VERSION ||
      envelope.principalId !== context.principalId ||
      envelope.authGeneration !== context.authGeneration
    ) {
      return null;
    }
    return envelope;
  } catch {
    return null;
  }
};

export const readCache = async <T>(key: string, maxAgeMs?: number): Promise<T | null> => {
  if (typeof window === 'undefined') return null;
  const context = readMobilePrincipalContext();
  if (!context) return null;
  const scopedKey = storageKey(context, key);
  const raw = window.localStorage.getItem(scopedKey);
  const envelope = await decryptEnvelope<T>(raw, context);
  if (!envelope) {
    if (raw) window.localStorage.removeItem(scopedKey);
    return null;
  }

  const savedAt = Date.parse(envelope.savedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  const expiredByContract = Number.isNaN(expiresAt) || Date.now() >= expiresAt;
  const expiredByCaller =
    maxAgeMs !== undefined &&
    (Number.isNaN(savedAt) || Date.now() - savedAt > Math.max(0, maxAgeMs));
  if (expiredByContract || expiredByCaller) {
    window.localStorage.removeItem(scopedKey);
    return null;
  }
  return envelope.data;
};

export const writeCache = async <T>(
  key: string,
  data: T,
  options: { maxAgeMs?: number } = {}
): Promise<void> => {
  if (typeof window === 'undefined') return;
  const context = readMobilePrincipalContext();
  if (!context) return;
  const now = Date.now();
  const maxAgeMs = Math.max(1_000, options.maxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS);
  const payload: CacheEnvelope<T> = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    principalId: context.principalId,
    authGeneration: context.authGeneration,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + maxAgeMs).toISOString(),
    data,
  };

  try {
    const encrypted = await encryptEnvelope(payload, context);
    if (!encrypted) return;
    window.localStorage.setItem(storageKey(context, key), JSON.stringify(encrypted));
  } catch (error: unknown) {
    if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') return;
    try {
      const namespace = `${MOBILE_CACHE_PREFIX}${principalStorageSegment(context)}:`;
      const entries: { key: string; savedAt: number }[] = [];
      for (const localStorageKey of Object.keys(window.localStorage)) {
        if (!localStorageKey.startsWith(namespace)) continue;
        try {
          const raw = window.localStorage.getItem(localStorageKey);
          const parsed = raw ? (JSON.parse(raw) as Partial<EncryptedEnvelope>) : null;
          if (typeof parsed?.savedAt === 'string') {
            entries.push({ key: localStorageKey, savedAt: Date.parse(parsed.savedAt) });
          }
        } catch {}
      }
      entries.sort((a, b) => a.savedAt - b.savedAt);
      for (const entry of entries.slice(0, Math.max(1, Math.ceil(entries.length * 0.25)))) {
        window.localStorage.removeItem(entry.key);
      }
      const retry = await encryptEnvelope(payload, context);
      if (retry) window.localStorage.setItem(storageKey(context, key), JSON.stringify(retry));
    } catch {
      console.warn('Mobile cache is full and scoped eviction failed');
    }
  }
};

function deleteIndexedDb(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Removes encrypted responder values and their origin-persisted key material. */
export async function purgeMobileCacheStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(MOBILE_CACHE_PREFIX)) window.localStorage.removeItem(key);
  }
  cryptoKeyPromises.clear();
  await deleteIndexedDb(MOBILE_CACHE_KEY_DATABASE);
}
