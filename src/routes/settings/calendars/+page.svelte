<script lang="ts">
  import { onMount } from 'svelte';
  import {
    isCalendarVisible,
    loadCalendarSelection,
    railCalendarSelectionStorageKey,
    saveCalendarSelection,
    setCalendarVisible,
    type CalendarSelection,
  } from '$lib/calendar';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

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
</script>

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

<style>
  .calendar-group {
    margin: 12px 0 0;
    padding: 12px 16px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .calendar-group legend {
    padding: 0 6px;
    color: var(--color-text-muted);
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
    accent-color: var(--color-accent);
  }
  .swatch {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: var(--radius-sm);
    background: var(--color);
  }
</style>
