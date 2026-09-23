<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<section aria-labelledby="google-sync-heading">
  <h2 id="google-sync-heading">Google data sync</h2>
  <p class="help">
    Connect a Google account with OAuth. Email Check uses the Gmail, Google Contacts, Google
    Calendar, and Google Other contacts APIs. Reconnect each account to grant access to Other
    contacts, which includes people saved by Gmail autocomplete. Restart the server after you
    connect or reconnect an account so the background Gmail listener reloads it. A failed download
    keeps the last complete local copy.
  </p>
  <p class="connect"><a href="/auth/google/start">Connect Google account</a></p>
  <div class="sync-list">
    {#each data.accounts as account}
      <form method="POST" action="?/syncGoogle" use:enhance class="sync-card">
        <input type="hidden" name="account" value={account.email} />
        <div>
          <strong>{account.email}</strong>
          <p>
            {account.connected ? 'OAuth connected' : 'OAuth connection required'}<br />Contacts: {account.contactsSyncedAt
              ? new Date(account.contactsSyncedAt).toLocaleString()
              : 'Not synced'}<br />Calendar: {account.calendarSyncedAt
              ? new Date(account.calendarSyncedAt).toLocaleString()
              : 'Not synced'}
          </p>
        </div>
        {#if account.connected}<button type="submit">Sync now</button>{:else}<a
            href="/auth/google/start">Reconnect</a
          >{/if}
      </form>
    {:else}<p class="help">Connect a Google account before you sync Google data.</p>{/each}
  </div>
</section>

<style>
  .connect {
    margin-top: 18px;
  }
  .connect a,
  .sync-card a {
    display: inline-block;
    color: var(--color-bg);
    background: var(--color-accent);
    padding: 10px 16px;
    border-radius: var(--radius-sm);
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 600;
  }
</style>
