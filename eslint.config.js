import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const HTTP_METHODS = '/^(get|post|put|patch|delete)$/';

export default tseslint.config(
  { ignores: ['dist', 'infra/cdk.out', 'infra/node_modules'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Logging goes through the Fastify / pino logger, never console.
      'no-console': 'error',
    },
  },
  {
    // Application code: structure rules (see README → Code structure).
    files: ['src/**/*.ts'],
    rules: {
      // Numbers live in src/constants or Config, never inline.
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
        },
      ],
      // One responsibility per file: split before a file grows past this.
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'no-restricted-syntax': [
        'error',
        {
          // Route paths come from ApiRoutes.
          selector: `CallExpression[callee.property.name=${HTTP_METHODS}] > Literal.arguments:first-child[value=/^\\//]`,
          message: 'Use a path from ApiRoutes (src/constants/api-routes.ts).',
        },
      ],
    },
  },
  {
    // Only repositories, the data layer and the generic sync / realtime engines run SQL
    // (Drizzle in repositories; raw SQL where the sync engine builds it from syncTables).
    files: ['src/modules/**/*.ts', 'src/core/**/*.ts'],
    ignores: [
      'src/modules/**/*-repository.ts',
      'src/modules/sync/pull.ts',
      'src/modules/sync/push/**',
      'src/modules/realtime/hub.ts',
      'src/modules/realtime/events.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.property.name=${HTTP_METHODS}] > Literal.arguments:first-child[value=/^\\//]`,
          message: 'Use a path from ApiRoutes (src/constants/api-routes.ts).',
        },
        {
          selector: "CallExpression[callee.property.name='query']",
          message:
            'Run SQL in a repository (src/modules/<feature>/*-repository.ts), not in a route or service.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['drizzle-orm', 'drizzle-orm/*'],
              message:
                'Query through a repository (src/modules/<feature>/*-repository.ts), not in a route or service.',
            },
          ],
        },
      ],
    },
  },
  {
    // Constants and Config are where numbers belong.
    files: ['src/constants/**/*.ts', 'src/core/config.ts'],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },
);
