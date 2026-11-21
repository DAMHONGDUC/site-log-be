// Writes the OpenAPI document to docs/openapi.json: npm run openapi
// With --check it only compares, and fails when the committed file is out of date (CI).
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import type { TokenVerifier } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { OPENAPI } from '../src/constants/openapi.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { Storage, createS3Client } from '../src/storage.js';

// Building the app needs no database, AWS or Firebase: nothing here is ever called.
const config = loadConfig({
  DATABASE_URL: 'postgres://openapi@localhost/openapi',
  AWS_REGION: 'eu-west-1',
  S3_BUCKET: 'openapi',
  NODE_ENV: 'production',
});
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const notUsed = (): Promise<never> => Promise.reject(new Error('not used'));
const tokens: TokenVerifier = { verify: notUsed, deleteUser: notUsed, revoke: notUsed };
const app = await buildApp({
  config,
  pool,
  tokens,
  storage: new Storage(createS3Client(config.awsRegion), config.s3Bucket, config.presignTtlSeconds),
  hub: new RealtimeHub(config, pool),
});
await app.ready();
const document = `${JSON.stringify(app.swagger(), null, 2)}\n`;
await app.close();
await pool.end();

if (process.argv.includes('--check')) {
  const committed = await readFile(OPENAPI.file, 'utf8').catch(() => '');
  if (committed !== document) {
    process.stderr.write(`${OPENAPI.file} is out of date: run npm run openapi and commit it.\n`);
    process.exit(1);
  }
  process.stdout.write(`${OPENAPI.file} is up to date.\n`);
} else {
  await writeFile(OPENAPI.file, document);
  process.stdout.write(`Wrote ${OPENAPI.file}.\n`);
}
