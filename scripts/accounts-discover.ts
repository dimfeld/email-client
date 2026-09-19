import { getDatabase, upsertAccount } from '../src/lib/server/db';
import { runJson } from './shared';

const result = (await runJson(['gog', 'auth', 'list', '--json'])) as {
	accounts?: Array<{ email?: string; client?: string }>;
};
const accounts = result.accounts ?? [];
const database = getDatabase();

for (const account of accounts) {
	if (account.email) upsertAccount(database, { email: account.email, client: account.client });
}

console.log(`Discovered ${accounts.filter((account) => account.email).length} gog account(s).`);
