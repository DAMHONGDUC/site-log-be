// Prints a Firebase ID token for a test user, for curl: npm run token -- you@example.com password
// Uses the dev Firebase project's Web API key (Firebase console → Project settings → General).
const apiKey = process.env.FIREBASE_WEB_API_KEY;
const email = process.argv[2];
const password = process.argv[3];

if (apiKey === undefined || email === undefined || password === undefined) {
  process.stderr.write('Usage: FIREBASE_WEB_API_KEY=… npm run token -- <email> <password>\n');
  process.exit(1);
}

const response = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  },
);
const body = (await response.json()) as { idToken?: string; error?: { message: string } };
if (body.idToken === undefined) {
  process.stderr.write(`Sign-in failed: ${body.error?.message ?? response.status}\n`);
  process.exit(1);
}
process.stdout.write(`${body.idToken}\n`);
