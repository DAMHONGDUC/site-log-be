import { Type } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { DURATIONS } from '../constants/durations.js';
import { LIMITS, PATTERNS } from '../constants/limits.js';
import { PUSH_KINDS } from '../constants/push.js';
import { ROLES } from '../constants/roles.js';

// Request shapes shared by several routes.
export const Schemas = {
  uuid: () => Type.String({ format: 'uuid' }),
  uid: () => Type.String({ pattern: PATTERNS.firebaseUid }),
  role: () => Type.Union(ROLES.map((role) => Type.Literal(role))),
  pushKinds: () =>
    Type.Array(Type.Union(PUSH_KINDS.map((kind) => Type.Literal(kind))), {
      maxItems: LIMITS.pushKindsPerDevice,
    }),
  objectKey: () => Type.String({ minLength: 1, maxLength: LIMITS.objectKeyMaxLength }),
  idParams: () => Type.Object({ id: Type.String({ format: 'uuid' }) }),
} as const;

// A per-minute rate limit; `perUser` keys on the token so one device cannot flood the API.
export function rateLimit(max: number, perUser = false) {
  return {
    max,
    timeWindow: DURATIONS.rateLimitWindow,
    ...(perUser
      ? { keyGenerator: (request: FastifyRequest) => request.headers.authorization ?? request.ip }
      : {}),
  };
}
