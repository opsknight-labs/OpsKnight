/** Do not extract credentials embedded in otherwise innocuous scalar fields. */
export function isSensitiveValue(value: string): boolean {
  return /(?:Bearer\s|eyJ[A-Za-z0-9_-]+\.|https?:\/\/[^\s]+[?&](?:key|token|secret)=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(
    value
  );
}
