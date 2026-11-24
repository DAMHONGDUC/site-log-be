// F19: creates the first Admin, once, on the server: npm run seed:admin -- <email> <firebase-uid>
// The uid is the Firebase uid of that account (Firebase console → Authentication).
import { loadConfig } from '../src/core/config.js';
import { Database } from '../src/data/database.js';
import { createPool } from '../src/data/pool.js';
import { nameFromEmail } from '../src/modules/team/index.js';
import { SCRIPT_TEXT } from '../src/constants/messages/script-text.js';
import { ROLE } from '../src/constants/domain/roles.js';
import { MEMBER_EVENT_TYPE } from '../src/constants/data/enums.js';

const [email, uid] = process.argv.slice(2);

if (email === undefined || uid === undefined) {
  process.stderr.write(SCRIPT_TEXT.seedUsage);
  process.exit(1);
}
const pool = createPool(loadConfig());
const db = new Database(pool);

if ((await db.repos.members.countLiveWithRole(ROLE.admin)) > 0) {
  process.stderr.write(SCRIPT_TEXT.adminExists);
  await pool.end();
  process.exit(1);
}
await db.transaction(async (repos) => {
  await repos.members.createAdmin(uid, email.toLowerCase(), nameFromEmail(email));
  await repos.memberEvents.record({
    actorUid: null,
    type: MEMBER_EVENT_TYPE.joined,
    subjectUid: uid,
    detail: { role: ROLE.admin, seeded: true },
  });
});
process.stdout.write(SCRIPT_TEXT.adminCreated(email, uid));
await pool.end();
