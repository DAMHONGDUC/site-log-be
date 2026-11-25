// Prints a Firebase ID token for a test user, for curl: npm run token -- you@example.com password
// Uses the dev Firebase project's Web API key (Firebase console → Project settings → General).
import { DEV_TOKEN, SCRIPT_TEXT } from '../src/constants/messages/script-text.js';

const apiKey = process.env[DEV_TOKEN.apiKeyEnv];
const email = process.argv[2];
const password = process.argv[3];

if (apiKey === undefined || email === undefined || password === undefined) {
  process.stderr.write(SCRIPT_TEXT.tokenUsage);
  process.exit(1);
}

const response = await fetch(DEV_TOKEN.signInUrl(apiKey), {
  method: DEV_TOKEN.method,
  headers: { ...DEV_TOKEN.headers },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
});
const body = (await response.json()) as { idToken?: string; error?: { message: string } };

if (body.idToken === undefined) {
  process.stderr.write(SCRIPT_TEXT.signInFailed(body.error?.message ?? response.status));
  process.exit(1);
}
process.stdout.write(`${body.idToken}\n`);
