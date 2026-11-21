// F19: creates the first Admin, once, on the server: npm run seed:admin -- <email> [uid]
// The uid is the Firebase uid of that account (Firebase console → Authentication).
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { recordMemberEvent } from '../src/team/events.js';

const [email, uid] = process.argv.slice(2);
if (email === undefined || uid === undefined) {
  process.stderr.write('Usage: npm run seed:admin -- <email> <firebase-uid>\n');
  process.exit(1);
}
const pool = createPool(loadConfig());
const admins = await pool.query(
  `select 1 from members where role = 'admin' and removed_at is null`,
);
if (admins.rows.length > 0) {
  process.stderr.write('An Admin already exists: invite people from the app instead.\n');
  await pool.end();
  process.exit(1);
}
await pool.query(
  `insert into members (uid, email, name, role) values ($1, $2, $3, 'admin')
   on conflict (uid) do update set role = 'admin', removed_at = null`,
  [uid, email.toLowerCase(), email.split('@')[0] ?? ''],
);
await recordMemberEvent(pool, {
  actorUid: null,
  type: 'joined',
  subjectUid: uid,
  detail: { role: 'admin', seeded: true },
});
process.stdout.write(`Admin ${email} (${uid}) created.\n`);
await pool.end();
