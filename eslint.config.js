import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from './tools/eslint/boundaries.js';

const HTTP_METHODS = '/^(get|post|put|patch|delete)$/';

// Route paths come from ApiRoutes.
const API_ROUTE_RULE = {
  selector: `CallExpression[callee.property.name=${HTTP_METHODS}] > Literal.arguments:first-child[value=/^\\//]`,
  message: 'Use a path from ApiRoutes (src/constants/http/api-routes.ts).',
};

const SQL_IN_REPOSITORY_RULE = {
  selector: "CallExpression[callee.property.name='query']",
  message:
    'Run SQL in a repository (src/modules/<feature>/*-repository.ts), not in a route or service.',
};

// No hard-coded strings: every value is a named constant in src/constants (README → Code
// structure). Allowed: '' (no text), typeof checks, the `in` operator, SQL handed to query(),
// Drizzle's for('update') and sql`` templates, and Fastify hook names (addHook('onClose')), which
// the compiler already checks.
const STRING = `Literal[raw=/^['"][^'"]/]`;
const STRING_MESSAGE = 'Define the string as a constant in src/constants and use it by name.';
const STRING_RULES = [
  `CallExpression:not([callee.property.name=/^(query|for|addHook)$/]) > ${STRING}`,
  `NewExpression > ${STRING}`,
  `BinaryExpression:not([left.operator='typeof']):not([operator='in']) > ${STRING}`,
  `Property > ${STRING}.value`,
  `ReturnStatement > ${STRING}`,
  `ArrayExpression > ${STRING}`,
  `VariableDeclarator > ${STRING}.init`,
  `ConditionalExpression > ${STRING}`,
  `AssignmentPattern > ${STRING}.right`,
  `:not(TaggedTemplateExpression):not(CallExpression[callee.property.name='query']) > TemplateLiteral > TemplateElement[value.raw=/(^|[^\\\\])[A-Za-z]/]`,
].map((selector) => ({ selector, message: STRING_MESSAGE }));

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
      'no-restricted-syntax': ['error', API_ROUTE_RULE, ...STRING_RULES],
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
      'no-restricted-syntax': ['error', API_ROUTE_RULE, SQL_IN_REPOSITORY_RULE, ...STRING_RULES],
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
    // Dependency direction: features meet only through their index.ts; constants are a leaf.
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    plugins: { boundaries },
    rules: { 'boundaries/feature-index': 'error', 'boundaries/constants-leaf': 'error' },
  },
  {
    // The npm scripts follow the same string rule.
    files: ['scripts/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...STRING_RULES] },
  },
  {
    // Constants and Config are where numbers belong.
    files: ['src/constants/**/*.ts', 'src/core/config.ts'],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },
  {
    // Where strings are defined: the constants, the table shapes, the sync table registry, and
    // the SQL the sync engine builds from it.
    files: [
      'src/constants/**/*.ts',
      'src/data/schema/**/*.ts',
      'src/modules/sync/tables.ts',
      'src/modules/sync/pull.ts',
      'src/modules/sync/push/sql.ts',
    ],
    rules: { 'no-restricted-syntax': ['error', API_ROUTE_RULE] },
  },
);
