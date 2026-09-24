<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const numberFormat = new Intl.NumberFormat();
  const syncedAt = (value: string | null) =>
    value ? new Date(value).toLocaleString() : 'Not synced';
</script>

<section aria-labelledby="account-heading">
  <h2 id="account-heading">{data.account.email}</h2>
  <p class="help">
    {data.account.connected ? 'OAuth connected' : 'OAuth connection required'} · {numberFormat.format(
      data.stats.messages
    )} messages · {numberFormat.format(data.stats.contacts)} contacts · {numberFormat.format(
      data.stats.calendars
    )} calendars
  </p>
</section>

<section aria-labelledby="account-details-heading">
  <h3 id="account-details-heading">Details</h3>
  <form method="POST" action="?/saveAccount" use:enhance>
    <label for="account-display-name">Your name</label>
    <p class="help">
      Jev and Luna use this name to find tasks and reminders for you. Google supplies a name when it
      is available.
    </p>
    <input
      id="account-display-name"
      name="displayName"
      value={data.account.displayName ?? ''}
      autocomplete="name"
    />
    <label for="account-alias">Label</label>
    <p class="help">
      A message shows its account as a badge. Enter a short label, for example Work or Personal. If
      you leave the label empty, the badge shows the email address.
    </p>
    <input id="account-alias" name="alias" value={data.account.alias ?? ''} autocomplete="off" />
    <p class="actions"><button type="submit">Save</button></p>
  </form>
</section>

<section aria-labelledby="account-sync-heading">
  <h3 id="account-sync-heading">Google data sync</h3>
  <p class="help">
    Reconnect the account to grant access to Other contacts, which includes people saved by Gmail
    autocomplete. Restart the server after you reconnect so the background Gmail listener reloads
    the account. A failed download keeps the last complete local copy.
  </p>
  <form method="POST" action="?/syncGoogle" use:enhance class="sync-card">
    <p>
      Contacts: {syncedAt(data.account.contactsSyncedAt)}<br />Calendar: {syncedAt(
        data.account.calendarSyncedAt
      )}
    </p>
    {#if data.account.connected}<button type="submit">Sync now</button>{:else}<a
        class="button-link"
        href="/auth/google/start">Reconnect</a
      >{/if}
  </form>
</section>

<style>
  h3 {
    margin-bottom: 4px;
  }
  label {
    font-weight: 600;
  }
  label + .help {
    margin-top: -4px;
    margin-bottom: 8px;
  }
  .actions {
    margin-top: 16px;
  }
  .sync-card {
    margin-top: 12px;
  }
  .sync-card p {
    margin: 0;
  }
</style>
