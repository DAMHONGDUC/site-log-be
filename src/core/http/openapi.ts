import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { ApiRoutes } from '../../constants/http/api-routes.js';
import { NODE_ENVS } from '../../constants/runtime/environments.js';
import { OPENAPI } from '../../constants/http/openapi.js';
import { SWAGGER_UI } from '../../constants/http/swagger-ui.js';

const PUBLIC = new Set<string>(OPENAPI.publicRoutes);
const HIDDEN = new Set<string>(OPENAPI.hiddenRoutes);

// Collects every route schema into one OpenAPI 3 document; the explorer is served outside production.
export async function registerOpenApi(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: OPENAPI.specVersion,
      info: { title: OPENAPI.title, version: OPENAPI.version, description: OPENAPI.description },
      components: {
        securitySchemes: {
          [OPENAPI.securityScheme]: { ...OPENAPI.auth },
        },
      },
      security: [{ [OPENAPI.securityScheme]: [] }],
    },
    transform: ({ schema, url }) => {
      const base = schema ?? {};

      if (HIDDEN.has(url)) {
        return { schema: { ...base, hide: true }, url };
      }

      return { schema: PUBLIC.has(url) ? { ...base, security: [] } : base, url };
    },
  });
  if (config.nodeEnv !== NODE_ENVS.production) {
    await app.register(swaggerUi, {
      routePrefix: ApiRoutes.DOCS,
      theme: { css: [...SWAGGER_UI.theme.css], js: [...SWAGGER_UI.theme.js] },
      uiConfig: { ...SWAGGER_UI.uiConfig },
    });
  }
}
