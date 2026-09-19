import { getDatabase, upsertAccount } from '../src/lib/server/db';
import { readFlag, requireFlag } from './shared';

const email = requireFlag('--account');
const subscription = requireFlag('--subscription');
const topic = readFlag('--topic');
const client = readFlag('--client');

upsertAccount(getDatabase(), { email, subscription, topic, client });
console.log(`Configured ${email}.`);
