import { Type } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { DURATIONS } from '../../constants/runtime/durations.js';
import { LIMITS, PATTERNS } from '../../constants/runtime/limits.js';
import { PUSH_KINDS } from '../../constants/domain/push.js';
import { ROLES } from '../../constants/domain/roles.js';
import { JSON_FORMAT } from '../../constants/http/openapi.js';

// Request shapes shared by several routes.
export const Schemas = {
  uuid: () => Type.String({ format: JSON_FORMAT.uuid }),
  uid: () => Type.String({ pattern: PATTERNS.firebaseUid }),
  role: () => Type.Union(ROLES.map((role) => Type.Literal(role))),
  pushKinds: () =>
    Type.Array(Type.Union(PUSH_KINDS.map((kind) => Type.Literal(kind))), {
      maxItems: LIMITS.pushKindsPerDevice,
    }),
  objectKey: () => Type.String({ minLength: 1, maxLength: LIMITS.objectKeyMaxLength }),
  idParams: () => Type.Object({ id: Type.String({ format: JSON_FORMAT.uuid }) }),
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
