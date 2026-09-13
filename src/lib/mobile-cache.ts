'use client';

const CACHE_SCHEMA_VERSION = 2;
const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type CacheEnvelope<T> = {
  schemaVersion: number;
  savedAt: string;
  expiresAt: string;
  data: T;
};

type EncryptedEnvelope = {
  schemaVersion: number;
  savedAt: string;
  expiresAt: string;
  iv: string;
  ciphertext: string;
};

const textEncoder = typeof window !== 'undefined' ? new TextEncoder() : null;
const textDecoder = typeof window !== 'undefined' ? new TextDecoder() : null;

const CACHE_PREFIX = 'opsknight:mobile-cache:';
const KEY_DATABASE = 'opsknight-secure-cache';
const KEY_STORE = 'keys';
const KEY_ID = 'mobile-cache-aes-gcm';
let cryptoKeyPromise: Promise<CryptoKey | null> | null = null;

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

const getCryptoKey = async (): Promise<CryptoKey | null> => {
  if (typeof window === 'undefined' || !window.crypto?.subtle || !window.indexedDB) return null;
  if (cryptoKeyPromise) return cryptoKeyPromise;

  cryptoKeyPromise = new Promise(resolve => {
    const request = window.indexedDB.open(KEY_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) {
        request.result.createObjectStore(KEY_STORE);
      }
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(KEY_ID);
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
            .put(key, KEY_ID);
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
  return cryptoKeyPromise;
};

const encryptEnvelope = async <T>(
  envelope: CacheEnvelope<T>
): Promise<EncryptedEnvelope | null> => {
  if (typeof window === 'undefined' || !window.crypto?.subtle || !textEncoder) return null;
  const key = await getCryptoKey();
  if (!key) return null;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = textEncoder.encode(JSON.stringify(envelope));
  const ciphertextBuffer = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    schemaVersion: envelope.schemaVersion,
    savedAt: envelope.savedAt,
    expiresAt: envelope.expiresAt,
    iv: base64Encode(iv.buffer),
    ciphertext: base64Encode(ciphertextBuffer),
  };
};

const decryptEnvelope = async <T>(value: string | null): Promise<CacheEnvelope<T> | null> => {
  if (!value || typeof window === 'undefined' || !window.crypto?.subtle || !textDecoder) return null;
  let stored: EncryptedEnvelope;
  try {
    stored = JSON.parse(value) as EncryptedEnvelope;
  } catch {
    return null;
  }
  if (
    stored.schemaVersion !== CACHE_SCHEMA_VERSION ||
    !stored.iv ||
    !stored.ciphertext ||
    !stored.expiresAt
  ) {
    return null;
  }
  const key = await getCryptoKey();
  if (!key) return null;
  try {
    const ivBuffer = base64Decode(stored.iv);
    const ciphertextBuffer = base64Decode(stored.ciphertext);
    const plaintextBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(ivBuffer) },
      key,
      ciphertextBuffer
    );
    const json = textDecoder.decode(plaintextBuffer);
    const envelope = JSON.parse(json) as CacheEnvelope<T>;
    return envelope.schemaVersion === CACHE_SCHEMA_VERSION ? envelope : null;
  } catch {
    return null;
  }
};

export const readCache = async <T>(key: string, maxAgeMs?: number): Promise<T | null> => {
  if (typeof window === 'undefined') return null;
  const storageKey = `${CACHE_PREFIX}${key}`;
  const raw = window.localStorage.getItem(storageKey);
  const envelope = await decryptEnvelope<T>(raw);
  if (!envelope) {
    if (raw) window.localStorage.removeItem(storageKey);
    return null;
  }

  const savedAt = Date.parse(envelope.savedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  const expiredByContract = Number.isNaN(expiresAt) || Date.now() >= expiresAt;
  const expiredByCaller =
    maxAgeMs !== undefined &&
    (Number.isNaN(savedAt) || Date.now() - savedAt > Math.max(0, maxAgeMs));

  if (expiredByContract || expiredByCaller) {
    window.localStorage.removeItem(storageKey);
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
  const now = Date.now();
  const maxAgeMs = Math.max(1_000, options.maxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS);
  const payload: CacheEnvelope<T> = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + maxAgeMs).toISOString(),
    data,
  };

  try {
    const encrypted = await encryptEnvelope(payload);
    if (!encrypted) return;
    window.localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(encrypted));
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      try {
        const keys = Object.keys(window.localStorage).filter(storageKey =>
          storageKey.startsWith(CACHE_PREFIX)
        );
        const entries: { key: string; savedAt: number }[] = [];
        for (const storageKey of keys) {
          try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) continue;
            const parsed = JSON.parse(raw) as Partial<EncryptedEnvelope>;
            if (typeof parsed.savedAt === 'string') {
              entries.push({ key: storageKey, savedAt: Date.parse(parsed.savedAt) });
            }
          } catch {}
        }
        entries.sort((a, b) => a.savedAt - b.savedAt);
        const toDelete = Math.max(1, Math.ceil(entries.length * 0.25));
        for (const entry of entries.slice(0, toDelete)) {
          window.localStorage.removeItem(entry.key);
        }

        const encrypted = await encryptEnvelope(payload);
        if (encrypted) {
          window.localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(encrypted));
        }
      } catch {
        console.warn('Mobile cache is full and eviction failed');
      }
    }
  }
};
