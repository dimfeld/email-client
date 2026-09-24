<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const numberFormat = new Intl.NumberFormat();
</script>

<section aria-labelledby="accounts-heading">
  <h2 id="accounts-heading">Accounts</h2>
  <p class="help">
    Connect a Google account with OAuth. Email Check uses the Gmail, Google Contacts, Google
    Calendar, and Google Other contacts APIs. Restart the server after you connect or reconnect an
    account so the background Gmail listener reloads it.
  </p>
  <p class="connect"><a class="button-link" href="/auth/google/start">Connect Google account</a></p>
  <div class="sync-list">
    {#each data.accounts as account (account.email)}
      <a
        class="sync-card account-card"
        href="/settings/accounts/{encodeURIComponent(account.email)}"
      >
        <div>
          <h3>{account.alias ?? account.email}</h3>
          <p>
            {#if account.alias}{account.email}<br />{/if}{account.connected
              ? 'OAuth connected'
              : 'OAuth connection required'}
          </p>
        </div>
        <dl>
          <div>
            <dt>Messages</dt>
            <dd>{numberFormat.format(account.stats.messages)}</dd>
          </div>
          <div>
            <dt>Contacts</dt>
            <dd>{numberFormat.format(account.stats.contacts)}</dd>
          </div>
          <div>
            <dt>Calendars</dt>
            <dd>{numberFormat.format(account.stats.calendars)}</dd>
          </div>
        </dl>
      </a>
    {:else}<p class="help">No accounts are connected.</p>{/each}
  </div>
</section>

<style>
  .connect {
    margin-top: 18px;
  }
  .account-card {
    color: inherit;
    text-decoration: none;
  }
  .account-card:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-raised);
  }
  dl {
    display: flex;
    gap: 24px;
    margin: 0;
  }
  dt {
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  dd {
    margin: 4px 0 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
