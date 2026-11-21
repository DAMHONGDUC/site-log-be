import js from '@eslint/js';
import tseslint from 'typescript-eslint';

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
);
