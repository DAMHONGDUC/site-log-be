// F19: creates the first Admin, once, on the server: npm run seed:admin -- <email> <firebase-uid>
// The uid is the Firebase uid of that account (Firebase console → Authentication).
import { loadConfig } from '../src/core/config.js';
import { Database } from '../src/data/database.js';
import { createPool } from '../src/data/pool.js';
import { nameFromEmail } from '../src/modules/team/invitations/invitation-token.js';

const [email, uid] = process.argv.slice(2);
if (email === undefined || uid === undefined) {
  process.stderr.write('Usage: npm run seed:admin -- <email> <firebase-uid>\n');
  process.exit(1);
}
const pool = createPool(loadConfig());
const db = new Database(pool);
if ((await db.repos.members.countLiveWithRole('admin')) > 0) {
  process.stderr.write('An Admin already exists: invite people from the app instead.\n');
  await pool.end();
  process.exit(1);
}
await db.transaction(async (repos) => {
  await repos.members.createAdmin(uid, email.toLowerCase(), nameFromEmail(email));
  await repos.memberEvents.record({
    actorUid: null,
    type: 'joined',
    subjectUid: uid,
    detail: { role: 'admin', seeded: true },
  });
});
process.stdout.write(`Admin ${email} (${uid}) created.\n`);
await pool.end();
