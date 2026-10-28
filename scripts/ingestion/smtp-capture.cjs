/* eslint-disable @typescript-eslint/no-require-imports -- Shared local certification helper. */
const assert = require('node:assert/strict');

async function observeSmtpDelivery({
  prisma,
  receiptId,
  recipient,
  userId,
  subjectToken,
  captureUrl,
  timeoutMs = 90000,
}) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000);
  for (const value of [receiptId, recipient, userId, subjectToken])
    assert.ok(typeof value === 'string' && value.length > 0);
  const deadline = Date.now() + timeoutMs;
  let captured, receipt, notification;
  while (Date.now() < deadline) {
    receipt = await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    assert.notEqual(receipt.status, 'DEAD', 'Paging fixture dead-lettered');
    const response = await fetch(`${captureUrl}/api/v1/messages`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.ok(response.ok, 'Owned SMTP capture API unavailable');
    const { messages } = await response.json();
    captured = messages?.find(
      message =>
        message.To?.some(to => to.Address === recipient) && message.Subject?.includes(subjectToken)
    );
    if (receipt.status === 'COMPLETED') {
      assert.equal(
        typeof receipt.result?.incidentId,
        'string',
        'Completed paging receipt lacks incident identity'
      );
      notification = await prisma.notification.findFirst({
        where: {
          incidentId: receipt.result.incidentId,
          userId,
          channel: 'EMAIL',
          status: { in: ['SENT', 'DELIVERED'] },
        },
      });
    }
    if (captured && notification) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(captured, 'Critical page did not reach the owned SMTP capture server');
  assert.ok(notification, 'Captured critical page lacks a successful durable delivery record');
  assert.equal(notification.deliveryProvider, 'smtp');
  assert.ok(notification.providerMessageId);
  const normalize = value => String(value).replace(/^<|>$/g, '');
  assert.equal(
    normalize(captured.MessageID),
    normalize(notification.providerMessageId),
    'Captured SMTP message does not match the persisted provider delivery ID'
  );
  return { captured, receipt, notification };
}
module.exports = { observeSmtpDelivery };
