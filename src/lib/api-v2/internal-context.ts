import { AsyncLocalStorage } from 'node:async_hooks';
import type { V2AuthContext } from './auth';
import type { Prisma } from '@prisma/client';

interface InternalInvocation {
  request: Request;
  auth: V2AuthContext;
  admitted: boolean;
  beforeMutation?: (tx: Prisma.TransactionClient) => Promise<void>;
}

// An in-process capability, bound to this exact Request. Headers cannot forge it.
const storage = new AsyncLocalStorage<InternalInvocation>();

export function withInternalV2Invocation<T>(
  request: Request,
  auth: V2AuthContext,
  callback: () => Promise<T>,
  beforeMutation?: InternalInvocation['beforeMutation']
) {
  return storage.run({ request, auth, admitted: true, beforeMutation }, callback);
}

export function internalV2MutationGuard() {
  return storage.getStore()?.beforeMutation;
}

export function internalV2Auth(request: Request) {
  const context = storage.getStore();
  return context?.request === request ? context.auth : undefined;
}

export function internalV2Admission(principalId: string) {
  const context = storage.getStore();
  return context?.admitted && context.auth.apiKey.id === principalId;
}
