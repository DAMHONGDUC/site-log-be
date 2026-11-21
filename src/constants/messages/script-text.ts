// What the npm scripts (scripts/*.ts) print, and the fixed values they use.

export const SCRIPT_TEXT = {
  tokenUsage: 'Usage: FIREBASE_WEB_API_KEY=… npm run token -- <email> <password>\n',
  signInFailed: (reason: string | number) => `Sign-in failed: ${reason}\n`,
  seedUsage: 'Usage: npm run seed:admin -- <email> <firebase-uid>\n',
  adminExists: 'An Admin already exists: invite people from the app instead.\n',
  adminCreated: (email: string, uid: string) => `Admin ${email} (${uid}) created.\n`,
  openapiStale: (file: string) => `${file} is out of date: run npm run openapi and commit it.\n`,
  openapiFresh: (file: string) => `${file} is up to date.\n`,
  openapiWritten: (file: string) => `Wrote ${file}.\n`,
  notUsed: 'not used',
} as const;

// scripts/dev-token.ts: Firebase Auth's REST sign-in for a test user.
export const DEV_TOKEN = {
  apiKeyEnv: 'FIREBASE_WEB_API_KEY',
  signInUrl: (apiKey: string) =>
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  method: 'POST',
  headers: { 'content-type': 'application/json' },
} as const;

// scripts/openapi.ts: building the app needs no database, AWS or Firebase; nothing is called.
export const OPENAPI_SCRIPT = {
  checkFlag: '--check',
  env: {
    DATABASE_URL: 'postgres://openapi@localhost/openapi',
    AWS_REGION: 'eu-west-1',
    S3_BUCKET: 'openapi',
    NODE_ENV: 'production',
  },
} as const;
