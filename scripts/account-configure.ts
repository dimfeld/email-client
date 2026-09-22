import { getDatabase, upsertAccount } from '../src/lib/server/db';
import { readFlag, requireFlag } from './shared';

const email = requireFlag('--account');
const project = process.env.GOOGLE_PROJECT_ID ?? 'dimfeld-gog-project';
const subscription = readFlag('--subscription') ?? `projects/${project}/subscriptions/gmail-agent`;
const topic = readFlag('--topic') ?? `projects/${project}/topics/gmail-events`;
upsertAccount(getDatabase(), { email, subscription, topic });
console.log(`Configured ${email}.`);
