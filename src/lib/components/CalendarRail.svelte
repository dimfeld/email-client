<script lang="ts">
  import CalendarEventDialog from './CalendarEventDialog.svelte';
  import PendingInvites from './PendingInvites.svelte';
  import Icon from './Icon.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import {
    addDays,
    calendarKey,
    dateKeyFromDate,
    eventCalendarKey,
    eventsOnDay,
    isCalendarVisible,
    layoutTimedEvents,
    loadCalendarSelection,
    railCalendarSelectionStorageKey,
    type CalendarSelection,
  } from '$lib/calendar';
  import type { SyncedCalendar, SyncedCalendarEvent } from '$lib/server/types';

  let {
    calendars,
    events,
    pendingInvites,
    day,
  }: {
    calendars: SyncedCalendar[];
    events: SyncedCalendarEvent[];
    pendingInvites: SyncedCalendarEvent[];
    day: string;
  } = $props();
  let selection = $state<CalendarSelection>({});
  let eventDialog = $state<CalendarEventDialog>();
  let visibleKeys = $derived(
    new Set(
      calendars
        .filter((calendar) => isCalendarVisible(calendar, selection))
        .map((calendar) => calendarKey(calendar.accountEmail, calendar.calendarId))
    )
  );
  let visibleEvents = $derived(events.filter((event) => visibleKeys.has(eventCalendarKey(event))));
  function changeDay(day: string) {
    const url = new URL(page.url);
    url.searchParams.set('day', day);
    void goto(url, { noScroll: true, keepFocus: true });
  }
  let scroller: HTMLDivElement;
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  let placements = $derived(layoutTimedEvents(visibleEvents, day));
  let allDay = $derived(eventsOnDay(visibleEvents, day).filter((event) => event.allDay));
  onMount(() => {
    selection = loadCalendarSelection(railCalendarSelectionStorageKey);
    scroller.scrollTop = new Date().getHours() * 52;
  });
</script>

<aside aria-label="Daily calendar">
  <header><a href="/calendar">Calendar</a><a href="/contacts">Contacts</a></header>
  <PendingInvites invites={pendingInvites} />
  <div class="day-heading">
    <strong
      >{new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(new Date(`${day}T12:00:00`))}</strong
    >
    <button aria-label="Previous day" onclick={() => changeDay(addDays(day, -1))}
      ><Icon name="chevron-left" /></button
    >
    <button aria-label="Today" onclick={() => changeDay(dateKeyFromDate(new Date()))}
      ><Icon name="today" /></button
    >
    <button aria-label="Next day" onclick={() => changeDay(addDays(day, 1))}
      ><Icon name="chevron-right" /></button
    >
  </div>
  {#each allDay as event}<button
      type="button"
      class="all-day"
      onclick={() => eventDialog?.open(event)}>{event.summary}</button
    >{/each}
  <div class="scroll" bind:this={scroller}>
    <div class="hours">
      {#each hours as hour}<div class="hour">
          <span
            >{new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(
              new Date(2000, 0, 1, hour)
            )}</span
          >
        </div>{/each}
      {#each placements as item}
        <button
          type="button"
          class="event"
          style:left={`calc(38px + (100% - 48px) * ${item.column / item.columns})`}
          style:width={`calc((100% - 48px) / ${item.columns})`}
          style:top={`${(item.startMinutes / 60) * 52}px`}
          style:height={`${((item.endMinutes - item.startMinutes) / 60) * 52}px`}
          title={item.event.summary}
          onclick={() => eventDialog?.open(item.event)}>{item.event.summary}</button
        >
      {/each}
    </div>
  </div>
</aside>
<CalendarEventDialog bind:this={eventDialog} {calendars} />

<style>
  aside {
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    font-size: var(--text-xs);
    overflow: hidden;
  }
  header {
    display: flex;
    gap: 20px;
    padding: 16px 12px;
  }
  a {
    color: var(--color-accent);
    text-decoration: none;
  }
  .day-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px;
    color: var(--color-text-muted);
  }
  strong {
    margin-right: auto;
    font-size: var(--text-xs);
    text-transform: uppercase;
  }
  button {
    background: none;
    border: 0;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .scroll {
    overflow-y: auto;
    flex: 1;
  }
  .hours {
    position: relative;
    padding-left: 38px;
  }
  .hour {
    height: 52px;
    border-top: 1px solid var(--color-surface-raised);
    margin-right: 10px;
  }
  .hour span {
    position: absolute;
    left: 6px;
    color: var(--color-text-faint);
    font-size: var(--text-xs);
  }
  .event,
  .all-day {
    font: inherit;
    text-align: left;
  }
  .event {
    position: absolute;
    min-height: 16px;
    padding: 2px 5px;
    border-radius: var(--radius-sm);
    color: var(--color-event-text);
    background: var(--color-event-bg);
    overflow: hidden;
  }
  .all-day {
    margin: 2px 10px 8px;
    padding: 4px;
    background: var(--color-accent-bg);
    border-radius: var(--radius-sm);
  }
</style>
