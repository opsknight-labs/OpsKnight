import { readRepositoryFile } from './discovery-lib.mjs';

export function inspectNotificationProviders() {
  const file = 'src/lib/notification-providers.ts';
  const source = readRepositoryFile(file);
  const functionBody = name => source.match(new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport (?:async )?function|$)`))?.[0] ?? '';
  const implementations = {
    EMAIL: functionBody('getAllConfiguredEmailProviders'),
    SMS: functionBody('getSMSConfig'),
    PUSH: functionBody('getPushConfig'),
    VOICE: functionBody('getVoiceConfig'),
    WHATSAPP: functionBody('getWhatsAppConfig'),
  };
  const providersIn = body => [...new Set([
    ...[...body.matchAll(/(?:records\.get\(|provider:\s*|where:\s*{\s*provider:\s*)['"]([^'"]+)['"]/g)].map(match => match[1]),
  ])];
  const channelProviders = {
    EMAIL: providersIn(implementations.EMAIL),
    SMS: providersIn(implementations.SMS),
    PUSH: providersIn(implementations.PUSH),
    VOICE: providersIn(implementations.VOICE),
    WHATSAPP: providersIn(implementations.WHATSAPP),
  };
  return Object.entries(channelProviders).flatMap(([channel, providers]) =>
    providers.map(provider => ({
      id: `${channel.toLowerCase()}.${provider}`,
      channel,
      provider,
      sources: [file],
      source: file,
      enabledCondition: /(?:\.enabled|Enabled\b)/.test(implementations[channel]) ? 'provider-record-enabled-and-implementation-credentials-valid' : 'unknown',
      credentialsDecrypted: /getDecryptedConfig/.test(implementations[channel]),
      requiredCredentials: [...new Set([...implementations[channel].matchAll(/config\.([A-Za-z][A-Za-z0-9]+)\b/g)].map(match => match[1]))].sort(),
      discovery: 'implementation',
    }))
  );
}

if (process.argv[1] === import.meta.filename) {
  console.log(JSON.stringify(inspectNotificationProviders(), null, 2));
}
