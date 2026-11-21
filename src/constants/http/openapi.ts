import { ApiRoutes } from './api-routes.js';

// The OpenAPI document the apps generate their clients from (docs/openapi.json).
export const OPENAPI = {
  title: 'Site Log API',
  version: '1.0.0',
  description: 'Sync, uploads, realtime and team API for the Site Log iOS and Android apps.',
  // The scheme every signed-in route uses: a Firebase ID token.
  securityScheme: 'firebaseIdToken',
  // Routes a caller reaches without a token.
  publicRoutes: [ApiRoutes.HEALTH, ApiRoutes.VERIFY, ApiRoutes.INVITATION_PREVIEW],
  // Routes left out of the document (not plain HTTP).
  hiddenRoutes: [ApiRoutes.WEBSOCKET],
  // The committed copy the CI compares against.
  file: 'docs/openapi.json',
  specVersion: '3.1.0',
  // How the Firebase ID token travels: Authorization: Bearer <jwt>.
  auth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
} as const;

// The request field the auth guard fills; Fastify needs its name and empty value up front.
export const REQUEST_UID = { field: 'uid', empty: '' } as const;

// JSON Schema string formats used by the route schemas.
export const JSON_FORMAT = { uuid: 'uuid', dateTime: 'date-time' } as const;
