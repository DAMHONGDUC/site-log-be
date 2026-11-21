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
} as const;
