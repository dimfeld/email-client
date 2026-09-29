<script lang="ts">
  import { enhance } from '$app/forms';
  import { importanceLabels, importanceRuleKindLabels } from '$lib/importance-rules';
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

<section aria-labelledby="account-importance-heading">
  <h3 id="account-importance-heading">Importance guidance</h3>
  <form method="POST" action="?/saveImportanceGuidance" use:enhance>
    <label for="account-importance-guidance">Guidance for Jev</label>
    <p class="help">
      Jev decides whether each message in this account is important, useful, or neither. Describe
      what matters to you, for example "Messages from my landlord are important" or "Receipts are
      useful". Jev reads this text with the importance question. It applies to new messages. Leave
      it empty to use no extra guidance.
    </p>
    <textarea
      id="account-importance-guidance"
      name="importanceGuidance"
      rows="6"
      value={data.account.importanceGuidance ?? ''}></textarea>
    <p class="actions"><button type="submit">Save</button></p>
  </form>
</section>

<section aria-labelledby="account-importance-rules-heading">
  <h3 id="account-importance-rules-heading">Importance rules</h3>
  <p class="help">
    A rule sets the importance of a matching message. It replaces the Jev answer and the category
    level. A sender address rule has priority over a domain rule, and a domain rule has priority
    over a subject rule. A domain rule also matches subdomains. A subject pattern is a regular
    expression, and case is not important. Rules apply to new messages.
  </p>
  <div class="sync-list">
    {#each data.importanceRules as rule (rule.id)}
      <form method="POST" action="?/removeImportanceRule" use:enhance class="sync-card">
        <input type="hidden" name="id" value={rule.id} />
        <div>
          <strong class="rule-pattern">{rule.pattern}</strong>
          <p>{importanceRuleKindLabels[rule.kind]} · {importanceLabels[rule.importance]}</p>
        </div>
        <button type="submit" class="remove">Remove</button>
      </form>
    {:else}<p class="help">No importance rules are saved.</p>{/each}
  </div>
  <form method="POST" action="?/addImportanceRule" use:enhance class="rule-form">
    <div>
      <label for="importance-rule-kind">Type</label>
      <select id="importance-rule-kind" name="kind">
        {#each Object.entries(importanceRuleKindLabels) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </div>
    <div class="rule-value">
      <label for="importance-rule-pattern">Value</label>
      <input
        id="importance-rule-pattern"
        name="pattern"
        required
        autocomplete="off"
        placeholder="name@example.com, example.com, or ^Invoice"
      />
    </div>
    <div>
      <label for="importance-rule-importance">Importance</label>
      <select id="importance-rule-importance" name="importance">
        {#each Object.entries(importanceLabels) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </div>
    <button type="submit">Add rule</button>
  </form>
</section>

<section aria-labelledby="account-sync-heading">
  <h3 id="account-sync-heading">Google data sync</h3>
  <p class="help">
    Contacts, including people saved by Gmail autocomplete, and calendar data sync in the
    background. Select Sync now to check for updates at any time. If a sync fails, the last complete
    local copy stays available.
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
  .rule-pattern {
    overflow-wrap: anywhere;
  }
  .rule-form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
    margin-top: 12px;
  }
  .rule-value {
    flex: 1 1 240px;
  }
  .sync-card p {
    margin: 0;
  }
</style>
