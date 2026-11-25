// Writes the OpenAPI document to docs/openapi.json: npm run openapi
// With --check it only compares, and fails when the committed file is out of date (CI).
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import type { TokenVerifier } from '../src/core/auth.js';
import { loadConfig } from '../src/core/config.js';
import { OPENAPI } from '../src/constants/http/openapi.js';
import { RealtimeHub } from '../src/modules/realtime/index.js';
import { Storage, createS3Client } from '../src/integrations/storage.js';
import { OPENAPI_SCRIPT, SCRIPT_TEXT } from '../src/constants/messages/script-text.js';
import { ENCODING } from '../src/constants/platform/encoding.js';

// Building the app needs no database, AWS or Firebase: nothing here is ever called.
const config = loadConfig({ ...OPENAPI_SCRIPT.env });
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const notUsed = (): Promise<never> => Promise.reject(new Error(SCRIPT_TEXT.notUsed));
const tokens: TokenVerifier = { verify: notUsed, deleteUser: notUsed, revoke: notUsed };
const app = await buildApp({
  config,
  pool,
  tokens,
  storage: new Storage(
    createS3Client({ region: config.awsRegion, endpoint: config.s3Endpoint }),
    config.s3Bucket,
    config.presignTtlSeconds,
  ),
  hub: new RealtimeHub(config, pool),
});

await app.ready();
const document = `${JSON.stringify(app.swagger(), null, 2)}\n`;

await app.close();
await pool.end();

if (process.argv.includes(OPENAPI_SCRIPT.checkFlag)) {
  const committed = await readFile(OPENAPI.file, ENCODING.utf8).catch(() => '');

  if (committed !== document) {
    process.stderr.write(SCRIPT_TEXT.openapiStale(OPENAPI.file));
    process.exit(1);
  }
  process.stdout.write(SCRIPT_TEXT.openapiFresh(OPENAPI.file));
} else {
  await writeFile(OPENAPI.file, document);
  process.stdout.write(SCRIPT_TEXT.openapiWritten(OPENAPI.file));
}
