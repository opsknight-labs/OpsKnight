import { readRepositoryFile } from './discovery-lib.mjs';

export function inspectNotificationProviders() {
  const file = 'src/lib/notification-providers.ts';
  const source = readRepositoryFile(file);
  const union = name => {
    const body = source.match(new RegExp(`export type ${name}Provider = ([^;]+);`))?.[1] ?? '';
    return [...body.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
  };
  const channelProviders = {
    EMAIL: union('Email'),
    SMS: union('SMS'),
    PUSH: union('Push'),
    VOICE: [...new Set([...source.matchAll(/provider:\s*['"](twilio)['"]/g)].map(match => match[1]))],
    WHATSAPP: ['twilio'],
  };
  return Object.entries(channelProviders).flatMap(([channel, providers]) =>
    providers.map(provider => ({
      id: `${channel.toLowerCase()}.${provider}`,
      channel,
      provider,
      source: file,
      enabledCondition: 'enabled provider record with decryptable required credentials',
    }))
  );
}

if (process.argv[1] === import.meta.filename) {
  console.log(JSON.stringify(inspectNotificationProviders(), null, 2));
}
