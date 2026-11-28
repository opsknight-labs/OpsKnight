import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

/**
 * Route handlers cannot see the TCP peer, so with proxy headers untrusted (the shipped default)
 * every caller used to resolve to 0.0.0.0 and share one rate-limit bucket. This stamps the real
 * peer address onto each request as `x-opsknight-peer-ip`, overwriting anything the client sent
 * under that name, so `getClientIp` can use it as the socket address (and TRUSTED_PROXIES can be
 * matched against it). The flag lives on globalThis because Next bundles each route separately.
 */
type Flagged = typeof globalThis & { opsknightPeerIpStamped?: boolean };

/** True only after the stamp is installed; otherwise the header is client-controlled and ignored. */
export function peerIpStampInstalled(): boolean {
  return (globalThis as Flagged).opsknightPeerIpStamped === true;
}

export function installPeerIpStamp(): void {
  if (peerIpStampInstalled()) return;
  for (const proto of [http.Server.prototype, https.Server.prototype]) {
    const emit = proto.emit;
    proto.emit = function (this: unknown, ...args: Parameters<typeof proto.emit>) {
      const [event, first] = args as unknown as [string | symbol, unknown];
      if (event === 'request') {
        const req = first as http.IncomingMessage;
        delete req.headers['x-opsknight-peer-ip'];
        const peer = req.socket?.remoteAddress?.replace(/^::ffff:/i, '');
        if (peer && isIP(peer)) req.headers['x-opsknight-peer-ip'] = peer;
      }
      return emit.apply(this, args);
    } as typeof proto.emit;
  }
  (globalThis as Flagged).opsknightPeerIpStamped = true;
}
