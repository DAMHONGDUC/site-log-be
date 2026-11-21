// Names Fastify needs up front for what the server adds to it.

// The request field the auth guard fills, and its empty value.
export const REQUEST_UID = { field: 'uid', empty: '' } as const;

// What every feature plugin reads from its Fastify instance (app.deps, app.guards).
export const APP_DECORATION = { deps: 'deps', guards: 'guards' } as const;
