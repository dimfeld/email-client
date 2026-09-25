<script lang="ts">
  import { enhance } from '$app/forms';
  import { calendarResponses, type CalendarResponse } from '$lib/calendar-response';
  import type { SyncedCalendarEvent } from '$lib/server/types';
  import Icon from './Icon.svelte';

  let { invites }: { invites: SyncedCalendarEvent[] } = $props();
  let chosen = $state<SyncedCalendarEvent | null>(null);
  let reply = $state<CalendarResponse | null>(null);
  let busy = $state(false);
  let error = $state('');
  let message = $state('');

  function choose(event: SyncedCalendarEvent, response: CalendarResponse) {
    chosen = event;
    reply = response;
    error = '';
    message = '';
  }

  function dateLabel(event: SyncedCalendarEvent): string {
    const date = new Date(event.allDay ? `${event.startAt}T12:00:00` : event.startAt);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      ...(event.allDay ? {} : { hour: 'numeric', minute: '2-digit' }),
    }).format(date);
  }
</script>

<details class="pending-invites">
  <summary aria-label={`Invitations: ${invites.length} need a response`}>
    <Icon name="calendar" />
    <span class="count">{invites.length}</span>
  </summary>
  <div class="invite-list">
    {#if invites.length === 0}
      <p class="empty">No invitations need a response.</p>
    {/if}
    {#each invites as event (`${event.accountEmail}\0${event.calendarId}\0${event.eventId}`)}
      <article class="invite">
        <strong>{event.summary || '(No title)'}</strong>
        <span>{dateLabel(event)} · {event.accountEmail}</span>
        <div class="options" aria-label={`Respond to ${event.summary}`}>
          {#each Object.entries(calendarResponses) as [value, label]}
            <button
              type="button"
              disabled={busy}
              aria-pressed={chosen?.eventId === event.eventId &&
                chosen?.calendarId === event.calendarId &&
                chosen?.accountEmail === event.accountEmail &&
                reply === value}
              onclick={() => choose(event, value as CalendarResponse)}>{label}</button
            >
          {/each}
          <form
            method="POST"
            action="/?/ignoreInvite"
            use:enhance={() => {
              busy = true;
              error = '';
              return async ({ result, update }) => {
                busy = false;
                await update({ reset: false, invalidateAll: false });
                if (result.type === 'success') {
                  if (
                    chosen?.eventId === event.eventId &&
                    chosen?.calendarId === event.calendarId &&
                    chosen?.accountEmail === event.accountEmail
                  ) {
                    chosen = null;
                    reply = null;
                  }
                  message = 'Invitation hidden from this list.';
                } else if (result.type === 'failure')
                  error = String(result.data?.error ?? 'Could not hide the invitation.');
              };
            }}
          >
            <input type="hidden" name="account" value={event.accountEmail} />
            <input type="hidden" name="calendar" value={event.calendarId} />
            <input type="hidden" name="event" value={event.eventId} />
            <button type="submit" disabled={busy}>Ignore</button>
          </form>
        </div>
        {#if chosen?.eventId === event.eventId && chosen?.calendarId === event.calendarId && chosen?.accountEmail === event.accountEmail && reply}
          <form
            class="confirmation"
            method="POST"
            action="/calendar?/respond"
            use:enhance={() => {
              busy = true;
              error = '';
              return async ({ result, update }) => {
                busy = false;
                await update({ reset: false, invalidateAll: false });
                if (result.type === 'success') {
                  chosen = null;
                  reply = null;
                  message = 'Calendar response sent.';
                } else if (result.type === 'failure')
                  error = String(result.data?.error ?? 'Calendar response failed.');
              };
            }}
          >
            <input type="hidden" name="account" value={event.accountEmail} />
            <input type="hidden" name="calendar" value={event.calendarId} />
            <input type="hidden" name="event" value={event.eventId} />
            <input type="hidden" name="response" value={reply} />
            <input type="hidden" name="confirmed" value="yes" />
            <p>
              Send “{calendarResponses[reply]}” for “{event.summary}” as {event.accountEmail}?
              Google will notify the guests.
            </p>
            <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send response'}</button>
            <button
              type="button"
              disabled={busy}
              onclick={() => {
                chosen = null;
                reply = null;
              }}>Cancel</button
            >
          </form>
        {/if}
      </article>
    {/each}
    {#if error}<p role="alert">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
  </div>
</details>

<style>
  .pending-invites {
    border-block: 1px solid var(--color-surface-raised);
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    cursor: pointer;
    padding: 10px 12px;
    color: var(--color-text-secondary);
    font-weight: 600;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .count {
    color: var(--color-accent);
  }
  .invite-list {
    max-height: 45vh;
    overflow-y: auto;
    padding: 0 12px 8px;
  }
  .empty {
    color: var(--color-text-muted);
  }
  .invite {
    border-top: 1px solid var(--color-surface-raised);
    padding: 10px 0;
  }
  .invite strong,
  .invite span {
    display: block;
  }
  .invite strong {
    color: var(--color-text);
  }
  .invite span {
    margin-top: 3px;
    color: var(--color-text-muted);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }
  button {
    border: 1px solid var(--color-surface-raised);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text-secondary);
    cursor: pointer;
    font: inherit;
    padding: 4px 6px;
  }
  button:hover,
  button[aria-pressed='true'] {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }
  button:disabled {
    cursor: wait;
    opacity: 0.6;
  }
  .confirmation {
    padding: 8px;
    margin-top: 8px;
    border-radius: var(--radius-sm);
    background: var(--color-accent-bg);
  }
  .confirmation p {
    margin: 0 0 8px;
    line-height: 1.4;
  }
  .confirmation button + button {
    margin-left: 4px;
  }
  [role='alert'] {
    color: var(--color-danger);
  }
</style>
