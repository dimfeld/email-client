<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<section aria-labelledby="account-names-heading">
  <h2 id="account-names-heading">Your names</h2>
  <p class="help">
    Jev and Luna use these names to find tasks and reminders for you. Google supplies a name when it
    is available. You can change it for each account.
  </p>
  <div class="sync-list">
    {#each data.accounts as account (account.email)}
      <form method="POST" action="?/saveAccountName" use:enhance class="sync-card">
        <input type="hidden" name="account" value={account.email} />
        <label class="account-name-label">
          <strong>{account.email}</strong>
          <input name="displayName" value={account.displayName ?? ''} autocomplete="name" />
        </label>
        <button type="submit">Save name</button>
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
