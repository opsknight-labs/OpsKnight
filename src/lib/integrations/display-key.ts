import 'server-only';

import { decryptStoredSecret } from '@/lib/encryption';
import { logger } from '@/lib/logger';

type StoredIntegrationKey = {
  id: string;
  key: string;
};

/**
 * Integration routing keys are stored encrypted (`v3:<keyId>:…`). Senders must
 * present the plaintext key, so anything we hand to a service manager (the
 * copied webhook URL, the Routing Key box, the cURL sample) has to be the
 * decrypted value.
 *
 * Returns a map of integration id → plaintext key. An integration whose key
 * cannot be decrypted maps to `null` so the page can tell the manager to rotate
 * it, instead of rendering ciphertext that will always fail with 401.
 *
 * Only call this for viewers who are allowed to manage the service.
 */
export async function resolveIntegrationKeysForDisplay(
  integrations: readonly StoredIntegrationKey[]
): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    integrations.map(async ({ id, key }): Promise<[string, string | null]> => {
      try {
        return [id, await decryptStoredSecret(key)];
      } catch (error) {
        logger.error('[Integrations] Unable to decrypt integration key for display', {
          integrationId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return [id, null];
      }
    })
  );
  return new Map(entries);
}
