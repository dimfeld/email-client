import { getDatabase } from '../src/lib/server/db';
import { syncConfiguredGoogleAccounts } from '../src/lib/server/google-sync';
import { readFlag } from './shared';

const results = await syncConfiguredGoogleAccounts(getDatabase(), readFlag('--account'));
for (const { account, result } of results) {
	console.log(`Synced ${result.contacts} contact(s), ${result.calendars} calendar(s), and ${result.events} event(s) for ${account}.`);
}
if (results.length === 0) console.log('No enabled Google OAuth accounts are configured.');
