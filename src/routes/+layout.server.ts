import { getDatabase, listAccounts, listContacts } from '$lib/server/db';
import { listDrafts } from '$lib/server/composer';
import { getVapidPublicKey } from '$lib/server/push';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = ({ depends }) => {
  depends('app:accounts', 'app:contacts', 'app:drafts');
  const database = getDatabase();
  return {
    vapidPublicKey: getVapidPublicKey(),
    composer: {
      accounts: listAccounts(database).map((account) => ({
        email: account.email,
        connected: Boolean(account.refreshToken),
      })),
      contacts: listContacts(database).map((contact) => ({
        name: contact.displayName,
        emails: contact.emails,
        account: contact.accountEmail,
      })),
      drafts: listDrafts(database),
    },
  };
};
