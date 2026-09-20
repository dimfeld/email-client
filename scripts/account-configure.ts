import { getDatabase, upsertAccount } from '../src/lib/server/db';
import { readFlag, requireFlag } from './shared';

const email = requireFlag('--account');
const subscription = requireFlag('--subscription');
const topic = readFlag('--topic');
upsertAccount(getDatabase(), { email, subscription, topic });
console.log(`Configured ${email}.`);
