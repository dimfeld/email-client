import { getDatabase } from '../src/lib/server/db';
import { renewGmailWatches } from '../src/lib/server/gmail-watch-renewal';

const result = await renewGmailWatches(getDatabase());
console.log(`Renewed ${result.renewed} Gmail watch(es); ${result.failed} failed.`);
if (result.failed > 0) process.exitCode = 1;
