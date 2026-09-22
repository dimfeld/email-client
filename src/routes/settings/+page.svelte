<script lang="ts">
  import HistoricalBackfillPanel from '$lib/components/HistoricalBackfillPanel.svelte';
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import {
    isCalendarVisible,
    loadCalendarSelection,
    railCalendarSelectionStorageKey,
    saveCalendarSelection,
    setCalendarVisible,
    type CalendarSelection,
  } from '$lib/calendar';
  import type { Category } from '$lib/categories';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let drafts = $state.raw<Record<string, Category>>({});
  let rows = $derived(
    [...data.categories, { id: '', name: '', description: '', level: 'auto' as const }].map(
      (category) =>
        drafts[category.id] ?? (form?.values?.id === category.id ? form.values : category)
    )
  );

  const submitCategory: SubmitFunction =
    ({ formData }) =>
    async ({ result, update }) => {
      await update({ reset: false });
      if (result.type === 'success') {
        const id = String(formData.get('id') ?? '');
        const { [id]: saved, ...remaining } = drafts;
        drafts = remaining;
      }
    };

  let railSelection = $state<CalendarSelection>({});
  let calendarAccounts = $derived([
    ...new Set(data.calendars.map((calendar) => calendar.accountEmail)),
  ]);
  onMount(() => {
    railSelection = loadCalendarSelection(railCalendarSelectionStorageKey);
  });

  function setRailVisible(calendar: (typeof data.calendars)[number], visible: boolean) {
    railSelection = setCalendarVisible(railSelection, calendar, visible);
    saveCalendarSelection(railCalendarSelectionStorageKey, railSelection);
  }

  function preserveDraft(category: Category) {
    if (!drafts[category.id]) drafts = { ...drafts, [category.id]: category };
  }
</script>

<svelte:head><title>Settings — Email Check</title></svelte:head>

<main>
  <header>
    <nav><a href="/">Mail</a><a href="/contacts">Contacts</a><a href="/calendar">Calendar</a></nav>
    <h1>Settings</h1>
    <p>Set the categories that Jev uses to sort mail across all accounts.</p>
  </header>
  {#if form?.error}<p class="feedback error" role="alert">{form.error}</p>{/if}
  {#if form?.message}<p class="feedback" role="status">{form.message}</p>{/if}
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
  <section aria-labelledby="remote-images-heading">
    <h2 id="remote-images-heading">Remote images</h2>
    <p class="help">
      Images from these senders load when you open a message. Add a sender from the arrow beside
      Load remote images in a message.
    </p>
    <div class="sync-list">
      {#each data.remoteImageRules as rule (rule.kind + rule.value)}
        <form method="POST" action="?/removeRemoteImageRule" use:enhance class="sync-card">
          <input type="hidden" name="kind" value={rule.kind} />
          <input type="hidden" name="value" value={rule.value} />
          <div>
            <strong>{rule.value}</strong>
            <p>{rule.kind === 'address' ? 'Email address' : 'Domain'}</p>
          </div>
          <button type="submit" class="remove">Remove</button>
        </form>
      {:else}<p class="help">No senders are saved.</p>{/each}
    </div>
  </section>
  <section aria-labelledby="rail-calendars-heading">
    <h2 id="rail-calendars-heading">Mail sidebar calendars</h2>
    <p class="help">
      Select the calendars that the daily calendar on the mail page shows. This browser keeps the
      selection. The Calendar page has a separate selection.
    </p>
    {#each calendarAccounts as accountEmail (accountEmail)}
      <fieldset class="calendar-group">
        <legend>{accountEmail}</legend>
        {#each data.calendars.filter((calendar) => calendar.accountEmail === accountEmail) as calendar (calendar.calendarId)}
          <label class="calendar-toggle">
            <input
              type="checkbox"
              checked={isCalendarVisible(calendar, railSelection)}
              onchange={(event) => setRailVisible(calendar, event.currentTarget.checked)}
            />
            <span class="swatch" style:--color={calendar.backgroundColor ?? '#6edff3'}></span>
            <span>{calendar.summary}</span>
          </label>
        {/each}
      </fieldset>
    {:else}<p class="help">Sync a Google account before you select calendars.</p>{/each}
  </section>
  <HistoricalBackfillPanel
    accounts={data.accounts}
    jobs={data.historicalBackfills}
    delayMs={data.historicalDelayMs}
  />
  <section aria-labelledby="categories-heading">
    <h2 id="categories-heading">Categories</h2>
    <p class="help">
      Jev uses each category name and description when it classifies a message. Changes apply to
      future classifications. Existing messages keep their category.
    </p>
    <p class="help">
      <strong>All important</strong> shows Important messages. <strong>Useful now</strong> shows Important
      and Useful messages. Fixed levels apply to all messages in the category.
    </p>
    <p class="help">
      With Auto, Jev chooses Important, Useful, or Other for each message. Existing messages without
      a result need another sync.
    </p>

    {#each rows as category (category)}
      <form
        method="POST"
        action="?/save"
        use:enhance={submitCategory}
        oninput={() => preserveDraft(category)}
        class="category-card"
        aria-label={category.id ? `Edit ${category.name}` : 'Add category'}
      >
        <input type="hidden" name="id" value={category.id} />
        <div class="card-heading">
          <h3>{category.id ? category.name : 'Add category'}</h3>
          <span class="badge"
            >{category.level === 'important'
              ? 'Important'
              : category.level === 'useful'
                ? 'Useful'
                : category.level === 'auto'
                  ? 'Auto'
                  : 'Other'}</span
          >
        </div>
        <label for={`name-${category.id}`}>Name</label>
        <input id={`name-${category.id}`} name="name" value={category.name} required />
        <label for={`description-${category.id}`}>Description</label>
        <textarea id={`description-${category.id}`} name="description" required rows="3"
          >{category.description}</textarea
        >
        <label for={`level-${category.id}`}>Level</label>
        <select id={`level-${category.id}`} name="level">
          <option value="important" selected={category.level === 'important'}>Important</option>
          <option value="useful" selected={category.level === 'useful'}>Useful</option>
          <option value="other" selected={category.level === 'other'}>Other</option>
          <option value="auto" selected={category.level === 'auto'}>Auto — let Jev decide</option>
        </select>
        <div class="actions">
          <button type="submit">{category.id ? 'Save category' : 'Add category'}</button>
          {#if category.id}<button type="submit" class="remove" formaction="?/remove" formnovalidate
              >Remove category</button
            >{/if}
        </div>
        {#if category.id}<p class="remove-help">
            If you remove this category, its messages will move to Needs classification.
          </p>{/if}
      </form>
    {/each}
  </section>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(html) {
    background: #07131c;
    color-scheme: dark;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }
  :global(body) {
    margin: 0;
    min-width: 320px;
    color: #edf7fb;
  }
  main {
    max-width: 860px;
    margin: auto;
    padding: 32px 24px 64px;
  }
  header {
    padding-bottom: 28px;
    border-bottom: 1px solid #23404e;
    margin-bottom: 28px;
  }
  nav {
    display: flex;
    gap: 18px;
  }
  nav a {
    color: #6edff3;
    text-decoration: none;
    font-size: 0.9rem;
  }
  h1 {
    margin: 24px 0 10px;
    font-size: 2rem;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 1.3rem;
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
    overflow-wrap: anywhere;
  }
  p {
    color: #9bb4bf;
    line-height: 1.6;
    margin: 0;
  }
  .help {
    margin-bottom: 12px;
    font-size: 0.9rem;
  }
  section + section {
    margin-top: 36px;
  }
  .sync-list {
    display: grid;
    gap: 10px;
    margin-top: 18px;
  }
  .connect {
    margin-top: 18px;
  }
  .connect a,
  .sync-card a {
    display: inline-block;
    color: #07131c;
    background: #6edff3;
    padding: 10px 16px;
    border-radius: 4px;
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .sync-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 16px;
    border: 1px solid #23404e;
    border-radius: 6px;
    background: #0b1c26;
  }
  .sync-card p {
    margin-top: 6px;
    color: #8eabb8;
    font-size: 0.75rem;
    line-height: 1.6;
  }
  .calendar-group {
    margin: 12px 0 0;
    padding: 12px 16px;
    border: 1px solid #23404e;
    border-radius: 6px;
    background: #0b1c26;
  }
  .calendar-group legend {
    padding: 0 6px;
    color: #8eabb8;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  label.calendar-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 6px 0;
    cursor: pointer;
  }
  .calendar-toggle input[type='checkbox'] {
    width: auto;
    margin: 0;
    padding: 0;
    accent-color: #6edff3;
  }
  .swatch {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: 3px;
    background: var(--color);
  }
  .category-card {
    padding: 24px;
    margin-top: 20px;
    background: #0d202b;
    border: 1px solid #23404e;
    border-radius: 8px;
  }
  .card-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .badge {
    background: #ffde5920;
    color: #ffde59;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
  }
  label {
    display: block;
    font-size: 0.85rem;
    margin: 16px 0 8px;
    color: #bfd1d8;
  }
  input,
  textarea,
  select,
  button {
    font: inherit;
  }
  input:not([type='hidden']),
  textarea,
  select {
    width: 100%;
    padding: 10px 12px;
    background: #07131c;
    color: #edf7fb;
    border: 1px solid #365869;
    border-radius: 4px;
  }
  textarea {
    resize: vertical;
    line-height: 1.5;
  }
  .actions {
    margin-top: 20px;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  button {
    cursor: pointer;
    border: 1px solid #6edff3;
    background: #6edff3;
    color: #07131c;
    padding: 10px 16px;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  button.remove {
    border-color: #365869;
    background: transparent;
    color: #ffa3b5;
  }
  .remove-help {
    margin-top: 14px;
    font-size: 0.75rem;
  }
  .feedback {
    padding: 14px 16px;
    border: 1px solid #365869;
    color: #a3effb;
    margin-top: 20px;
    border-radius: 4px;
  }
  .error {
    color: #ffa3b5;
  }
  :focus-visible {
    outline: 2px solid #6edff3;
    outline-offset: 3px;
  }
  @media (max-width: 760px) {
    main {
      padding: 24px 16px;
    }
    .category-card {
      padding: 18px;
    }
    .sync-card {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
