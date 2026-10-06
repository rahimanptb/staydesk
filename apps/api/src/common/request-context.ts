import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';

/** Facts about the current HTTP request, available anywhere in its async call chain. */
export interface RequestMeta {
  requestId: string;
  ip: string;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestMeta>();

export function registerRequestContext(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', (request, _reply, done) => {
    const userAgent = request.headers['user-agent'];
    storage.run(
      {
        requestId: request.id,
        ip: request.ip,
        userAgent: userAgent ? userAgent.slice(0, 500) : null,
      },
      done,
    );
  });
}

export function requestMeta(): RequestMeta | undefined {
  return storage.getStore();
}
