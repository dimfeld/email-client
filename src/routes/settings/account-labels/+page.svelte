<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<section aria-labelledby="account-labels-heading">
  <h2 id="account-labels-heading">Account labels</h2>
  <p class="help">
    A message shows its account as a badge. Enter a short label, for example Work or Personal. If
    you leave the label empty, the badge shows the email address.
  </p>
  <div class="sync-list">
    {#each data.accounts as account (account.email)}
      <form method="POST" action="?/saveAccountAlias" use:enhance class="sync-card">
        <input type="hidden" name="account" value={account.email} />
        <label class="account-name-label">
          <strong>{account.email}</strong>
          <input name="alias" value={account.alias ?? ''} autocomplete="off" />
        </label>
        <button type="submit">Save label</button>
      </form>
    {/each}
  </div>
</section>

<style>
  .account-name-label {
    flex: 1;
    margin: 0;
  }
  .account-name-label input {
    margin-top: 8px;
  }
</style>
