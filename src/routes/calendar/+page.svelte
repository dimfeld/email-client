<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { enhance } from '$app/forms';
  import {
    canRespondToEvent,
    calendarResponses,
    type CalendarResponse,
  } from '$lib/calendar-response';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import type { SyncedCalendarEvent } from '$lib/server/types';
  import {
    addDays,
    calendarKey,
    calendarSelectionStorageKey,
    calendarViews,
    dateKeyFromDate,
    daysBetween,
    eventCalendarKey,
    eventInterval,
    eventKey,
    eventsOnDay,
    isCalendarVisible,
    layoutTimedEvents,
    loadCalendarSelection,
    localTime,
    saveCalendarSelection,
    setCalendarVisible,
    shiftView,
    type CalendarSelection,
    type CalendarView,
    type DateKey,
  } from '$lib/calendar';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let reply = $state<CalendarResponse | null>(null);
  let sending = $state(false);
  let replyError = $state('');
  let replyMessage = $state('');

  let selection = $state<CalendarSelection>({});
  let today = $state(dateKeyFromDate(new Date()));
  let now = $state(Date.now());
  let selectedEvent = $state<SyncedCalendarEvent | null>(null);
  let dialog = $state<HTMLDialogElement>();
  let scroller = $state<HTMLDivElement>();

  const fallbackColor = '#6edff3';
  const viewLabels: Record<CalendarView, string> = { day: 'Day', week: 'Week', month: 'Month' };

  let accounts = $derived([...new Set(data.calendars.map((calendar) => calendar.accountEmail))]);
  let calendarsByKey = $derived(
    new Map(
      data.calendars.map((calendar) => [
        calendarKey(calendar.accountEmail, calendar.calendarId),
        calendar,
      ])
    )
  );
  let visibleKeys = $derived(
    new Set(
      data.calendars
        .filter((calendar) => isCalendarVisible(calendar, selection))
        .map((calendar) => calendarKey(calendar.accountEmail, calendar.calendarId))
    )
  );
  let visibleEvents = $derived(
    data.events.filter((event) => visibleKeys.has(eventCalendarKey(event)))
  );
  let days = $derived(daysBetween(data.range.start, data.range.end));
  let month = $derived(data.date.slice(0, 7));
  let weekdayNames = $derived(days.slice(0, 7).map((day) => formatDate(day, { weekday: 'short' })));
  let title = $derived.by(() => {
    if (data.view === 'month') return formatDate(data.date, { month: 'long', year: 'numeric' });
    if (data.view === 'day')
      return formatDate(data.date, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    const last = addDays(data.range.end, -1);
    const sameMonth = data.range.start.slice(0, 7) === last.slice(0, 7);
    return `${formatDate(data.range.start, { month: 'short', day: 'numeric', ...(sameMonth ? {} : { year: 'numeric' }) })} – ${formatDate(last, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  });
  let hours = Array.from({ length: 24 }, (_, hour) => hour);

  onMount(() => {
    selection = loadCalendarSelection(calendarSelectionStorageKey);
    const tick = setInterval(() => {
      now = Date.now();
      today = dateKeyFromDate(new Date());
    }, 60_000);
    return () => clearInterval(tick);
  });

  $effect(() => {
    // Scroll the time grid to the first event of the range, or to the current hour when the range is empty.
    const view = data.view;
    const element = scroller;
    if (view === 'month' || !element) return;
    const firstStart = days
      .flatMap((day) => layoutTimedEvents(visibleEvents, day))
      .reduce((earliest, placement) => Math.min(earliest, placement.startMinutes), Infinity);
    const minutes = Number.isFinite(firstStart) ? firstStart : new Date().getHours() * 60;
    const hourHeight = element.scrollHeight / 24;
    element.scrollTop = Math.max(0, (minutes / 60 - 1) * hourHeight);
  });

  function persistSelection(next: CalendarSelection) {
    selection = next;
    saveCalendarSelection(calendarSelectionStorageKey, next);
  }

  function setAccountVisible(accountEmail: string, visible: boolean) {
    let next = selection;
    for (const calendar of data.calendars) {
      if (calendar.accountEmail === accountEmail)
        next = setCalendarVisible(next, calendar, visible);
    }
    persistSelection(next);
  }

  function href(view: CalendarView, date: DateKey) {
    return `${resolve('/calendar')}?view=${view}&date=${date}`;
  }

  function calendarColor(event: Pick<SyncedCalendarEvent, 'accountEmail' | 'calendarId'>) {
    return calendarsByKey.get(eventCalendarKey(event))?.backgroundColor ?? fallbackColor;
  }

  function calendarName(event: Pick<SyncedCalendarEvent, 'accountEmail' | 'calendarId'>) {
    return calendarsByKey.get(eventCalendarKey(event))?.summary ?? event.calendarId;
  }

  function formatDate(key: DateKey, options: Intl.DateTimeFormatOptions) {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(localTime(key, true)));
  }

  function formatTime(ms: number) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(ms)
    );
  }

  function formatHour(hour: number) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(
      new Date(2000, 0, 1, hour)
    );
  }

  function formatEventRange(event: SyncedCalendarEvent) {
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    };
    if (event.allDay) {
      const lastDay = addDays(event.endAt, -1);
      if (lastDay <= event.startAt) return formatDate(event.startAt, dateOptions);
      return `${formatDate(event.startAt, dateOptions)} – ${formatDate(lastDay, dateOptions)}`;
    }
    const { start, end } = eventInterval(event);
    const startDay = dateKeyFromDate(new Date(start));
    const endDay = dateKeyFromDate(new Date(end));
    if (startDay === endDay)
      return `${formatDate(startDay, dateOptions)}, ${formatTime(start)} – ${formatTime(end)}`;
    return `${formatDate(startDay, dateOptions)}, ${formatTime(start)} – ${formatDate(endDay, dateOptions)}, ${formatTime(end)}`;
  }

  function eventStartLabel(event: SyncedCalendarEvent) {
    return formatTime(eventInterval(event).start);
  }

  function openEvent(event: SyncedCalendarEvent) {
    selectedEvent = event;
    reply = null;
    replyError = '';
    replyMessage = '';
    dialog?.showModal();
  }

  function nowMinutes(day: DateKey) {
    return (now - localTime(day, true)) / 60_000;
  }
</script>

<svelte:head><title>{title} — Calendar — Email Check</title></svelte:head>

<main>
  {#if form?.error && !selectedEvent}<p role="alert">{form.error}</p>{/if}
  {#if form?.message && !selectedEvent}<p role="status">{form.message}</p>{/if}
  <header class="masthead">
    <a class="brand" href="/"><span aria-hidden="true">@</span><strong>Email Check</strong></a>
    <nav aria-label="Application">
      <a href="/">Mail</a><a href="/contacts">Contacts</a><a class="active" href="/calendar"
        >Calendar</a
      ><a href="/settings">Settings</a>
    </nav>
  </header>
  <section class="content">
    <div class="toolbar">
      <div class="range-nav">
        <a
          class="button"
          href={href(data.view, shiftView(data.view, data.date, -1))}
          aria-label="Previous {data.view}"><Icon name="chevron-left" /></a
        >
        <a class="button" href={href(data.view, today)}>Today</a>
        <a
          class="button"
          href={href(data.view, shiftView(data.view, data.date, 1))}
          aria-label="Next {data.view}"><Icon name="chevron-right" /></a
        >
      </div>
      <h1>{title}</h1>
      <div class="view-switch" role="group" aria-label="Calendar view">
        {#each calendarViews as view (view)}
          <a
            class="button"
            class:active={view === data.view}
            aria-current={view === data.view ? 'page' : undefined}
            href={href(view, data.date)}>{viewLabels[view]}</a
          >
        {/each}
      </div>
    </div>

    <div class="body">
      <aside class="calendars" aria-label="Calendars">
        {#each accounts as accountEmail (accountEmail)}
          <div class="account">
            <div class="account-heading">
              <h2>{accountEmail}</h2>
              <button type="button" onclick={() => setAccountVisible(accountEmail, true)}
                >All</button
              >
              <button type="button" onclick={() => setAccountVisible(accountEmail, false)}
                >None</button
              >
            </div>
            {#each data.calendars.filter((calendar) => calendar.accountEmail === accountEmail) as calendar (calendar.calendarId)}
              <label class="calendar-toggle">
                <input
                  type="checkbox"
                  checked={isCalendarVisible(calendar, selection)}
                  onchange={(event) =>
                    persistSelection(
                      setCalendarVisible(selection, calendar, event.currentTarget.checked)
                    )}
                />
                <span class="swatch" style:--color={calendar.backgroundColor ?? fallbackColor}
                ></span>
                <span class="name">{calendar.summary}</span>
              </label>
            {/each}
          </div>
        {:else}
          <div class="empty">
            <h2>No synced calendars</h2>
            <p>Run <code>bun run sync:google</code> to download calendars and events.</p>
          </div>
        {/each}
      </aside>

      {#if data.view === 'month'}
        <div class="month" style:--weeks={days.length / 7}>
          {#each weekdayNames as name (name)}<div class="weekday">{name}</div>{/each}
          {#each days as day (day)}
            <div class="cell" class:outside={day.slice(0, 7) !== month} class:today={day === today}>
              <a
                class="day-number"
                href={href('day', day)}
                aria-label={formatDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}
                >{Number(day.slice(8))}</a
              >
              <ul>
                {#each eventsOnDay(visibleEvents, day) as event (eventKey(event))}
                  <li>
                    <button
                      type="button"
                      class="chip"
                      class:allday={event.allDay}
                      style:--color={calendarColor(event)}
                      onclick={() => openEvent(event)}
                    >
                      {#if !event.allDay}<time>{eventStartLabel(event)}</time>{/if}<span
                        >{event.summary || '(No title)'}</span
                      >
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {:else}
        <div class="timegrid" style:--days={days.length}>
          <div class="grid-head">
            <div class="corner"></div>
            {#each days as day (day)}
              <a class="day-head" class:today={day === today} href={href('day', day)}>
                <span>{formatDate(day, { weekday: 'short' })}</span><strong
                  >{Number(day.slice(8))}</strong
                >
              </a>
            {/each}
          </div>
          <div class="allday-row">
            <div class="corner">all-day</div>
            {#each days as day (day)}
              <div class="allday-cell">
                {#each eventsOnDay(visibleEvents, day).filter((event) => event.allDay) as event (eventKey(event))}
                  <button
                    type="button"
                    class="chip allday"
                    style:--color={calendarColor(event)}
                    onclick={() => openEvent(event)}
                    ><span>{event.summary || '(No title)'}</span></button
                  >
                {/each}
              </div>
            {/each}
          </div>
          <div class="scroll" bind:this={scroller}>
            <div class="hours">
              {#each hours as hour (hour)}<div class="hour-label">
                  {#if hour > 0}{formatHour(hour)}{/if}
                </div>{/each}
            </div>
            {#each days as day (day)}
              <div class="day-column" class:today={day === today}>
                {#each hours as hour (hour)}<div class="hour-line"></div>{/each}
                {#each layoutTimedEvents(visibleEvents, day) as placement (eventKey(placement.event))}
                  <button
                    type="button"
                    class="block"
                    class:continues-before={placement.continuesBefore}
                    class:continues-after={placement.continuesAfter}
                    style:--color={calendarColor(placement.event)}
                    style:top="{(placement.startMinutes / 1440) * 100}%"
                    style:height="{(Math.max(placement.endMinutes - placement.startMinutes, 15) /
                      1440) *
                      100}%"
                    style:left="{(placement.column / placement.columns) * 100}%"
                    style:width="{(1 / placement.columns) * 100}%"
                    onclick={() => openEvent(placement.event)}
                  >
                    <strong>{placement.event.summary || '(No title)'}</strong>
                    <span>{formatTime(eventInterval(placement.event).start)}</span>
                  </button>
                {/each}
                {#if day === today}
                  <div class="now-line" style:top="{(nowMinutes(day) / 1440) * 100}%"></div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </section>
</main>

<dialog bind:this={dialog} onclose={() => (selectedEvent = null)}>
  {#if selectedEvent}
    <article class="details" style:--color={calendarColor(selectedEvent)}>
      <div class="details-meta">
        <span class="badge">{calendarName(selectedEvent)}</span><small
          >{selectedEvent.accountEmail}</small
        >
      </div>
      <h2>{selectedEvent.summary || '(No title)'}</h2>
      <p class="when">{formatEventRange(selectedEvent)}</p>
      {#if selectedEvent.status && selectedEvent.status !== 'confirmed'}<p class="status">
          {selectedEvent.status}
        </p>{/if}
      {#if selectedEvent.location}<p><strong>Location</strong> {selectedEvent.location}</p>{/if}
      {#if selectedEvent.organizer}<p><strong>Organizer</strong> {selectedEvent.organizer}</p>{/if}
      {#if selectedEvent.attendees.length}<p>
          <strong>Attendees</strong>
          {selectedEvent.attendees.join(', ')}
        </p>{/if}
      {#if selectedEvent.description}<pre class="description">{selectedEvent.description}</pre>{/if}
      {#if canRespondToEvent(selectedEvent)}
        <section class="invite-response" aria-label="Invitation response">
          <p>
            Your response: <strong>{selectedEvent.responseStatus ?? 'Not yet available'}</strong>
          </p>
          <div class="response-options">
            {#each Object.entries(calendarResponses) as [value, label]}<button
                type="button"
                disabled={sending}
                aria-pressed={reply === value}
                onclick={() => {
                  reply = value as CalendarResponse;
                  replyError = '';
                  replyMessage = '';
                }}>{label}</button
              >{/each}
          </div>
          {#if reply}
            <form
              method="POST"
              action="?/respond"
              use:enhance={() => {
                sending = true;
                return async ({ result, update }) => {
                  sending = false;
                  await update({ reset: false });
                  if (result.type === 'success' && selectedEvent) {
                    selectedEvent = {
                      ...selectedEvent,
                      responseStatus: String(result.data?.responseStatus),
                    };
                    reply = null;
                    replyMessage = 'Calendar response sent.';
                  } else if (result.type === 'failure')
                    replyError = String(result.data?.error ?? 'Calendar response failed.');
                };
              }}
            >
              <input type="hidden" name="account" value={selectedEvent.accountEmail} /><input
                type="hidden"
                name="calendar"
                value={selectedEvent.calendarId}
              /><input type="hidden" name="event" value={selectedEvent.eventId} /><input
                type="hidden"
                name="response"
                value={reply}
              /><input type="hidden" name="confirmed" value="yes" />
              <p>
                Send “{calendarResponses[reply]}” for “{selectedEvent.summary}” as {selectedEvent.accountEmail}?
                Google will notify the guests.
              </p>
              <button type="submit" disabled={sending}
                >{sending ? 'Sending…' : 'Send response'}</button
              ><button type="button" disabled={sending} onclick={() => (reply = null)}
                >Cancel</button
              >
            </form>
          {/if}
          {#if replyError}<p role="alert">{replyError}</p>{/if}{#if replyMessage}<p role="status">
              {replyMessage}
            </p>{/if}
        </section>
      {/if}
      <div class="details-actions">
        {#if selectedEvent.htmlLink}<a
            href={selectedEvent.htmlLink}
            target="_blank"
            rel="noreferrer">Open in Google Calendar</a
          >{/if}
        <button type="button" onclick={() => dialog?.close()}>Close</button>
      </div>
    </article>
  {/if}
</dialog>

<style>
  a {
    color: var(--color-accent);
  }
  .masthead {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--color-border);
  }
  .brand {
    display: flex;
    gap: 10px;
    color: var(--color-text);
    text-decoration: none;
  }
  .brand span {
    color: var(--color-accent);
    font-size: 1.4rem;
  }
  nav {
    margin-left: auto;
    display: flex;
    gap: 18px;
  }
  nav a {
    color: var(--color-text-muted);
    text-decoration: none;
    font-size: 0.85rem;
  }
  nav a.active {
    color: var(--color-accent);
  }
  .content {
    width: min(1400px, 100%);
    margin: 0 auto;
    padding: 24px;
  }
  h1,
  h2,
  p {
    margin: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }
  .toolbar h1 {
    font-size: 1.4rem;
    flex: 1;
    min-width: 200px;
  }
  .range-nav,
  .view-switch {
    display: flex;
    gap: 4px;
  }
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    padding: 7px 12px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font-size: 0.85rem;
    text-decoration: none;
  }
  .button:hover {
    border-color: var(--color-accent);
    color: var(--color-text);
  }
  .button.active {
    background: var(--color-accent-bg);
    border-color: var(--color-accent);
    color: var(--color-accent-text);
  }

  .body {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 20px;
    margin-top: 20px;
    align-items: start;
  }
  .calendars {
    position: sticky;
    top: 16px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .account h2 {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
    flex: 1;
  }
  .account-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .account-heading button {
    font: inherit;
    font-size: var(--text-xs);
    padding: 2px 6px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
  }
  .account-heading button:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }
  .calendar-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 2px;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .calendar-toggle input {
    margin: 0;
    accent-color: var(--color-accent);
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-sm);
    background: var(--color);
    flex: none;
  }
  .calendar-toggle .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    padding: 24px 16px;
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    text-align: center;
  }
  .empty h2 {
    font-size: 1rem;
  }
  .empty p {
    margin-top: 10px;
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }

  .chip {
    display: flex;
    align-items: baseline;
    gap: 5px;
    width: 100%;
    padding: 2px 6px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  .chip:hover {
    background: var(--color-accent-bg-subtle);
  }
  .chip time {
    color: var(--color-text-muted);
    flex: none;
  }
  .chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip:not(.allday)::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color);
    flex: none;
    align-self: center;
  }
  .chip.allday {
    background: var(--color);
    color: var(--color-bg);
    font-weight: 600;
  }
  .chip.allday:hover {
    filter: brightness(1.1);
  }

  .month {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-template-rows: auto repeat(var(--weeks), minmax(110px, 1fr));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-border);
    gap: 1px;
  }
  .weekday {
    padding: 8px;
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .cell {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 6px 4px;
    background: var(--color-surface);
  }
  .cell.outside {
    background: var(--color-bg);
  }
  .cell.outside .day-number {
    color: var(--color-text-faint);
  }
  .day-number {
    align-self: flex-end;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    color: var(--color-text-secondary);
    font-size: 0.8rem;
    text-decoration: none;
  }
  .day-number:hover {
    background: var(--color-accent-bg);
  }
  .cell.today .day-number {
    background: var(--color-accent);
    color: var(--color-bg);
    font-weight: 700;
  }
  .cell ul {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .timegrid {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-surface);
    --hour: 48px;
    --gutter: 56px;
  }
  .grid-head,
  .allday-row,
  .scroll {
    display: grid;
    grid-template-columns: var(--gutter) repeat(var(--days), minmax(0, 1fr));
  }
  .grid-head {
    border-bottom: 1px solid var(--color-border);
  }
  .day-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 4px;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-decoration: none;
    border-left: 1px solid var(--color-border);
  }
  .day-head strong {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--color-text);
    font-size: 1.05rem;
    letter-spacing: 0;
  }
  .day-head.today strong {
    background: var(--color-accent);
    color: var(--color-bg);
  }
  .day-head:hover strong {
    background: var(--color-accent-bg);
  }
  .day-head.today:hover strong {
    background: var(--color-accent);
  }
  .allday-row {
    border-bottom: 1px solid var(--color-border);
    min-height: 28px;
  }
  .allday-row .corner {
    padding: 6px 8px;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    text-align: right;
  }
  .allday-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px 3px;
    border-left: 1px solid var(--color-border);
    min-width: 0;
  }
  .scroll {
    max-height: calc(100vh - 260px);
    min-height: 320px;
    overflow-y: auto;
    position: relative;
  }
  .hours {
    position: relative;
    height: calc(var(--hour) * 24);
  }
  .hour-label {
    height: var(--hour);
    padding: 0 8px;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    text-align: right;
    transform: translateY(-0.55em);
  }
  .day-column {
    position: relative;
    height: calc(var(--hour) * 24);
    border-left: 1px solid var(--color-border);
    min-width: 0;
  }
  .day-column.today {
    background: var(--color-surface);
  }
  .hour-line {
    height: var(--hour);
    border-top: 1px solid var(--color-accent-bg-subtle);
  }
  .block {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 3px 5px;
    margin: 0;
    border: 0;
    border-left: 3px solid var(--color);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color) 28%, var(--color-surface));
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--color-surface);
  }
  .block:hover {
    background: color-mix(in srgb, var(--color) 45%, var(--color-surface));
    z-index: 1;
  }
  .block strong {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .block span {
    color: var(--color-text-secondary);
  }
  .block.continues-before {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  .block.continues-after {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .now-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--color-danger-strong);
    pointer-events: none;
    z-index: 2;
  }
  .now-line::before {
    content: '';
    position: absolute;
    left: -4px;
    top: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-danger-strong);
  }

  dialog {
    width: min(520px, calc(100% - 32px));
    padding: 0;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    color: var(--color-text);
  }
  dialog::backdrop {
    background: rgba(2, 10, 16, 0.7);
  }
  .details {
    padding: 22px 24px;
    border-top: 4px solid var(--color);
  }
  .details-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .badge {
    padding: 3px 7px;
    border-radius: var(--radius-sm);
    background: var(--color);
    color: var(--color-bg);
    font-weight: 600;
  }
  .details h2 {
    margin-top: 10px;
    font-size: 1.25rem;
  }
  .when {
    margin-top: 6px;
    color: var(--color-accent-text);
    font-size: 0.85rem;
  }
  .status {
    margin-top: 4px;
    color: var(--color-caution);
    font-size: 0.78rem;
    text-transform: capitalize;
  }
  .details p {
    margin-top: 10px;
    color: var(--color-text-secondary);
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }
  .details p strong {
    color: var(--color-text-muted);
    font-weight: 600;
    margin-right: 6px;
  }
  .description {
    margin: 14px 0 0;
    padding: 12px;
    border-radius: var(--radius-md);
    background: var(--color-bg);
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 0.8rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 260px;
    overflow: auto;
  }
  .details-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 18px;
    font-size: 0.82rem;
  }
  .details-actions button {
    font: inherit;
    font-size: 0.82rem;
    padding: 7px 14px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;
    margin-left: auto;
  }
  .details-actions button:hover {
    border-color: var(--color-accent);
    color: var(--color-text);
  }

  .invite-response {
    margin-top: 18px;
    border-top: 1px solid var(--color-border-strong);
    padding-top: 10px;
  }
  .invite-response button {
    margin: 8px 8px 0 0;
    padding: 8px 12px;
    background: var(--color-accent-bg);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    color: var(--color-text);
    cursor: pointer;
  }
  .invite-response button[aria-pressed='true'] {
    border-color: var(--color-accent);
  }
  .invite-response button:disabled {
    opacity: 0.5;
  }
  @media (max-width: 900px) {
    .masthead {
      flex-wrap: wrap;
    }
    nav {
      width: 100%;
      margin: 0;
      overflow-x: auto;
    }
    .content {
      padding: 16px;
    }
    .body {
      grid-template-columns: 1fr;
    }
    .calendars {
      position: static;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 16px 28px;
    }
    .month {
      grid-template-rows: auto repeat(var(--weeks), minmax(72px, 1fr));
    }
    .chip time {
      display: none;
    }
    .timegrid {
      --gutter: 44px;
    }
    .scroll {
      max-height: 60vh;
    }
  }
</style>
