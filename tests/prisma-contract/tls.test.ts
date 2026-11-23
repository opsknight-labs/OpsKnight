import { afterAll, describe, it } from 'vitest';
import { createContractClient, disconnectContractClients, requireEnv } from './support/client';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('tls');

afterAll(disconnectContractClients);

function url(hostPort: string, params: Record<string, string>) {
  const parsed = new URL(`postgresql://opsknight:contract_password@${hostPort}/opsknight_contract`);
  for (const [key, value] of Object.entries(params)) parsed.searchParams.set(key, value);
  return parsed.toString();
}

async function probe(connectionUrl: string) {
  const prisma = createContractClient(connectionUrl);
  return outcome(
    () =>
      prisma.$queryRaw<Array<{ ssl: boolean }>>`
        SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`,
    rows => ({ ssl: rows[0]?.ssl ?? null })
  );
}

// The non-TLS server rejects nothing; the TLS server rejects every plaintext connection.
const PLAIN = () => new URL(requireEnv('CONTRACT_DATABASE_URL')).host;
const TLS = () => requireEnv('CONTRACT_TLS_HOST_PORT');
const TLS_BY_IP = () => TLS().replace(/^localhost/, '127.0.0.1');

describe('sslmode semantics against a server without TLS', () => {
  for (const mode of ['disable', 'prefer', 'require']) {
    it(mode, async () => {
      golden.observe(`plain.${mode}`, await probe(url(PLAIN(), { sslmode: mode })));
    });
  }
  it('no sslmode', async () => {
    golden.observe('plain.default', await probe(url(PLAIN(), {})));
  });
});

describe('sslmode semantics against a TLS-only server with a private CA', () => {
  for (const mode of ['disable', 'prefer', 'require']) {
    it(mode, async () => {
      golden.observe(`tls.${mode}`, await probe(url(TLS(), { sslmode: mode })));
    });
  }
  it('no sslmode', async () => {
    golden.observe('tls.default', await probe(url(TLS(), {})));
  });
  it('require with the trusted CA and strict acceptance', async () => {
    golden.observe(
      'tls.requireTrustedCaStrict',
      await probe(
        url(TLS(), {
          sslmode: 'require',
          sslrootcert: requireEnv('CONTRACT_TLS_CA_FILE'),
          sslaccept: 'strict',
        })
      )
    );
  });
  it('require with an untrusted CA and strict acceptance', async () => {
    golden.observe(
      'tls.requireUntrustedCaStrict',
      await probe(
        url(TLS(), {
          sslmode: 'require',
          sslrootcert: requireEnv('CONTRACT_TLS_OTHER_CA_FILE'),
          sslaccept: 'strict',
        })
      )
    );
  });
  it('require with accept_invalid_certs', async () => {
    golden.observe(
      'tls.requireAcceptInvalid',
      await probe(url(TLS(), { sslmode: 'require', sslaccept: 'accept_invalid_certs' }))
    );
  });
  it('strict acceptance against a host name that is not in the certificate', async () => {
    golden.observe(
      'tls.requireTrustedCaStrictWrongHost',
      await probe(
        url(TLS_BY_IP(), {
          sslmode: 'require',
          sslrootcert: requireEnv('CONTRACT_TLS_CA_FILE'),
          sslaccept: 'strict',
        })
      )
    );
  });

  // libpq verification modes as written in OpsKnight's deployment documentation.
  const ca = () => requireEnv('CONTRACT_TLS_CA_FILE');
  const otherCa = () => requireEnv('CONTRACT_TLS_OTHER_CA_FILE');
  const verifyCases: Record<string, () => [string, Record<string, string>]> = {
    verifyFullTrustedCa: () => [TLS(), { sslmode: 'verify-full', sslrootcert: ca() }],
    verifyFullUntrustedCa: () => [TLS(), { sslmode: 'verify-full', sslrootcert: otherCa() }],
    verifyFullNoRootCert: () => [TLS(), { sslmode: 'verify-full' }],
    verifyFullWrongHost: () => [TLS_BY_IP(), { sslmode: 'verify-full', sslrootcert: ca() }],
    verifyCaTrustedCa: () => [TLS(), { sslmode: 'verify-ca', sslrootcert: ca() }],
    verifyCaUntrustedCa: () => [TLS(), { sslmode: 'verify-ca', sslrootcert: otherCa() }],
    verifyCaWrongHost: () => [TLS_BY_IP(), { sslmode: 'verify-ca', sslrootcert: ca() }],
    requireWithTrustedRootCert: () => [TLS(), { sslmode: 'require', sslrootcert: ca() }],
    requireWithUntrustedRootCert: () => [TLS(), { sslmode: 'require', sslrootcert: otherCa() }],
    allow: () => [TLS(), { sslmode: 'allow' }],
    unknownMode: () => [TLS(), { sslmode: 'bogus' }],
  };
  for (const [name, build] of Object.entries(verifyCases)) {
    it(name, async () => {
      const [hostPort, params] = build();
      golden.observe(`tls.${name}`, await probe(url(hostPort, params)));
    });
  }
  it('verify-full against a server without TLS', async () => {
    golden.observe(
      'plain.verifyFull',
      await probe(url(PLAIN(), { sslmode: 'verify-full', sslrootcert: ca() }))
    );
  });
});
