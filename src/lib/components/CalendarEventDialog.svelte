<script lang="ts">
  import { enhance } from '$app/forms';
  import {
    canRespondToEvent,
    calendarResponses,
    type CalendarResponse,
  } from '$lib/calendar-response';
  import {
    addDays,
    calendarFallbackColor,
    calendarKey,
    dateKeyFromDate,
    eventCalendarKey,
    eventInterval,
    localTime,
    type DateKey,
  } from '$lib/calendar';
  import type { SyncedCalendar, SyncedCalendarEvent } from '$lib/server/types';

  let { calendars }: { calendars: SyncedCalendar[] } = $props();
  let reply = $state<CalendarResponse | null>(null);
  let sending = $state(false);
  let replyError = $state('');
  let replyMessage = $state('');
  let selectedEvent = $state<SyncedCalendarEvent | null>(null);
  let dialog = $state<HTMLDialogElement>();

  export function open(event: SyncedCalendarEvent) {
    selectedEvent = event;
    reply = null;
    replyError = '';
    replyMessage = '';
    dialog?.showModal();
  }

  function calendarFor(event: SyncedCalendarEvent) {
    const key = eventCalendarKey(event);
    return calendars.find(
      (calendar) => calendarKey(calendar.accountEmail, calendar.calendarId) === key
    );
  }

  function calendarColor(event: SyncedCalendarEvent) {
    return calendarFor(event)?.backgroundColor ?? calendarFallbackColor;
  }

  function calendarName(event: SyncedCalendarEvent) {
    return calendarFor(event)?.summary ?? event.calendarId;
  }

  function formatDate(key: DateKey, options: Intl.DateTimeFormatOptions) {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(localTime(key, true)));
  }

  function formatTime(ms: number) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(ms)
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
</script>

<!-- Keys typed in the dialog must not reach page keyboard shortcuts. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  onclose={() => (selectedEvent = null)}
  onkeydown={(event) => event.stopPropagation()}
>
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
              action="/calendar?/respond"
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
</style>
