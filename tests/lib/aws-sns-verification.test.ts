import { generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalSnsMessage,
  trustedSnsUrl,
  verifySnsMessageWithPem,
  type SnsEnvelope,
} from '@/lib/integrations/aws-sns-verification';

function envelope(): SnsEnvelope {
  return {
    Type: 'Notification',
    MessageId: 'message-1',
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:alerts',
    Timestamp: '2026-09-05T00:00:00.000Z',
    SignatureVersion: '2',
    Signature: '',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-aabbcc.pem',
    Message: '{"AlarmName":"cpu"}',
    Subject: 'alarm',
  };
}

describe('AWS SNS verification', () => {
  it('accepts a valid canonical signature and rejects tampering', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const message = envelope();
    message.Signature = sign(
      'RSA-SHA256',
      Buffer.from(canonicalSnsMessage(message)),
      privateKey
    ).toString('base64');
    expect(
      verifySnsMessageWithPem(message, publicKey.export({ type: 'spki', format: 'pem' }).toString())
    ).toBe(true);
    expect(
      verifySnsMessageWithPem(
        { ...message, TopicArn: `${message.TopicArn}-evil` },
        publicKey.export({ type: 'spki', format: 'pem' }).toString()
      )
    ).toBe(false);
  });

  it('allows only AWS SNS HTTPS certificate and confirmation endpoints', () => {
    expect(trustedSnsUrl(envelope().SigningCertURL, 'certificate').hostname).toBe(
      'sns.us-east-1.amazonaws.com'
    );
    expect(() =>
      trustedSnsUrl(
        'https://sns.us-east-1.amazonaws.com.evil.test/SimpleNotificationService-aa.pem',
        'certificate'
      )
    ).toThrow();
    expect(() =>
      trustedSnsUrl('https://sns.us-east-1.amazonaws.com/other.pem', 'certificate')
    ).toThrow();
    expect(() =>
      trustedSnsUrl(
        'http://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
        'subscription'
      )
    ).toThrow();
  });
});
