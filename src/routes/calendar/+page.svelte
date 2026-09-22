<script lang="ts">
	import { enhance } from '$app/forms';
	import { canRespondToEvent, calendarResponses, type CalendarResponse } from '$lib/calendar-response';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { SyncedCalendarEvent } from '$lib/server/types';
	import {
		addDays, calendarKey, calendarSelectionStorageKey, calendarViews, dateKeyFromDate, daysBetween,
		eventCalendarKey, eventInterval, eventKey, eventsOnDay, isCalendarVisible, layoutTimedEvents,
		loadCalendarSelection, localTime, saveCalendarSelection, setCalendarVisible, shiftView,
		type CalendarSelection, type CalendarView, type DateKey
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
	let calendarsByKey = $derived(new Map(data.calendars.map((calendar) => [calendarKey(calendar.accountEmail, calendar.calendarId), calendar])));
	let visibleKeys = $derived(new Set(data.calendars.filter((calendar) => isCalendarVisible(calendar, selection))
		.map((calendar) => calendarKey(calendar.accountEmail, calendar.calendarId))));
	let visibleEvents = $derived(data.events.filter((event) => visibleKeys.has(eventCalendarKey(event))));
	let days = $derived(daysBetween(data.range.start, data.range.end));
	let month = $derived(data.date.slice(0, 7));
	let weekdayNames = $derived(days.slice(0, 7).map((day) => formatDate(day, { weekday: 'short' })));
	let title = $derived.by(() => {
		if (data.view === 'month') return formatDate(data.date, { month: 'long', year: 'numeric' });
		if (data.view === 'day') return formatDate(data.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
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
		const firstStart = days.flatMap((day) => layoutTimedEvents(visibleEvents, day)).reduce(
			(earliest, placement) => Math.min(earliest, placement.startMinutes), Infinity);
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
			if (calendar.accountEmail === accountEmail) next = setCalendarVisible(next, calendar, visible);
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
		return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
	}

	function formatHour(hour: number) {
		return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour));
	}

	function formatEventRange(event: SyncedCalendarEvent) {
		const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
		if (event.allDay) {
			const lastDay = addDays(event.endAt, -1);
			if (lastDay <= event.startAt) return formatDate(event.startAt, dateOptions);
			return `${formatDate(event.startAt, dateOptions)} – ${formatDate(lastDay, dateOptions)}`;
		}
		const { start, end } = eventInterval(event);
		const startDay = dateKeyFromDate(new Date(start));
		const endDay = dateKeyFromDate(new Date(end));
		if (startDay === endDay) return `${formatDate(startDay, dateOptions)}, ${formatTime(start)} – ${formatTime(end)}`;
		return `${formatDate(startDay, dateOptions)}, ${formatTime(start)} – ${formatDate(endDay, dateOptions)}, ${formatTime(end)}`;
	}

	function eventStartLabel(event: SyncedCalendarEvent) {
		return formatTime(eventInterval(event).start);
	}

	function openEvent(event: SyncedCalendarEvent) {
		selectedEvent = event; reply = null; replyError = ''; replyMessage = '';
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
	<header class="masthead"><a class="brand" href="/"><span aria-hidden="true">@</span><strong>Email Check</strong></a><nav aria-label="Application"><a href="/">Mail</a><a href="/contacts">Contacts</a><a class="active" href="/calendar">Calendar</a><a href="/settings">Settings</a></nav></header>
	<section class="content">
		<div class="toolbar">
			<div class="range-nav">
				<a class="button" href={href(data.view, shiftView(data.view, data.date, -1))} aria-label="Previous {data.view}">‹</a>
				<a class="button" href={href(data.view, today)}>Today</a>
				<a class="button" href={href(data.view, shiftView(data.view, data.date, 1))} aria-label="Next {data.view}">›</a>
			</div>
			<h1>{title}</h1>
			<div class="view-switch" role="group" aria-label="Calendar view">
				{#each calendarViews as view (view)}
					<a class="button" class:active={view === data.view} aria-current={view === data.view ? 'page' : undefined} href={href(view, data.date)}>{viewLabels[view]}</a>
				{/each}
			</div>
		</div>

		<div class="body">
			<aside class="calendars" aria-label="Calendars">
				{#each accounts as accountEmail (accountEmail)}
					<div class="account">
						<div class="account-heading">
							<h2>{accountEmail}</h2>
							<button type="button" onclick={() => setAccountVisible(accountEmail, true)}>All</button>
							<button type="button" onclick={() => setAccountVisible(accountEmail, false)}>None</button>
						</div>
						{#each data.calendars.filter((calendar) => calendar.accountEmail === accountEmail) as calendar (calendar.calendarId)}
							<label class="calendar-toggle">
								<input type="checkbox" checked={isCalendarVisible(calendar, selection)}
									onchange={(event) => persistSelection(setCalendarVisible(selection, calendar, event.currentTarget.checked))} />
								<span class="swatch" style:--color={calendar.backgroundColor ?? fallbackColor}></span>
								<span class="name">{calendar.summary}</span>
							</label>
						{/each}
					</div>
				{:else}
					<div class="empty"><h2>No synced calendars</h2><p>Run <code>bun run sync:google</code> to download calendars and events.</p></div>
				{/each}
			</aside>

			{#if data.view === 'month'}
				<div class="month" style:--weeks={days.length / 7}>
					{#each weekdayNames as name (name)}<div class="weekday">{name}</div>{/each}
					{#each days as day (day)}
						<div class="cell" class:outside={day.slice(0, 7) !== month} class:today={day === today}>
							<a class="day-number" href={href('day', day)} aria-label={formatDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}>{Number(day.slice(8))}</a>
							<ul>
								{#each eventsOnDay(visibleEvents, day) as event (eventKey(event))}
									<li>
										<button type="button" class="chip" class:allday={event.allDay} style:--color={calendarColor(event)} onclick={() => openEvent(event)}>
											{#if !event.allDay}<time>{eventStartLabel(event)}</time>{/if}<span>{event.summary || '(No title)'}</span>
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
								<span>{formatDate(day, { weekday: 'short' })}</span><strong>{Number(day.slice(8))}</strong>
							</a>
						{/each}
					</div>
					<div class="allday-row">
						<div class="corner">all-day</div>
						{#each days as day (day)}
							<div class="allday-cell">
								{#each eventsOnDay(visibleEvents, day).filter((event) => event.allDay) as event (eventKey(event))}
									<button type="button" class="chip allday" style:--color={calendarColor(event)} onclick={() => openEvent(event)}><span>{event.summary || '(No title)'}</span></button>
								{/each}
							</div>
						{/each}
					</div>
					<div class="scroll" bind:this={scroller}>
						<div class="hours">
							{#each hours as hour (hour)}<div class="hour-label">{#if hour > 0}{formatHour(hour)}{/if}</div>{/each}
						</div>
						{#each days as day (day)}
							<div class="day-column" class:today={day === today}>
								{#each hours as hour (hour)}<div class="hour-line"></div>{/each}
								{#each layoutTimedEvents(visibleEvents, day) as placement (eventKey(placement.event))}
									<button type="button" class="block" class:continues-before={placement.continuesBefore} class:continues-after={placement.continuesAfter}
										style:--color={calendarColor(placement.event)}
										style:top="{(placement.startMinutes / 1440) * 100}%"
										style:height="{(Math.max(placement.endMinutes - placement.startMinutes, 15) / 1440) * 100}%"
										style:left="{(placement.column / placement.columns) * 100}%"
										style:width="{(1 / placement.columns) * 100}%"
										onclick={() => openEvent(placement.event)}>
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
			<div class="details-meta"><span class="badge">{calendarName(selectedEvent)}</span><small>{selectedEvent.accountEmail}</small></div>
			<h2>{selectedEvent.summary || '(No title)'}</h2>
			<p class="when">{formatEventRange(selectedEvent)}</p>
			{#if selectedEvent.status && selectedEvent.status !== 'confirmed'}<p class="status">{selectedEvent.status}</p>{/if}
			{#if selectedEvent.location}<p><strong>Location</strong> {selectedEvent.location}</p>{/if}
			{#if selectedEvent.organizer}<p><strong>Organizer</strong> {selectedEvent.organizer}</p>{/if}
			{#if selectedEvent.attendees.length}<p><strong>Attendees</strong> {selectedEvent.attendees.join(', ')}</p>{/if}
			{#if selectedEvent.description}<pre class="description">{selectedEvent.description}</pre>{/if}
			{#if canRespondToEvent(selectedEvent)}
				<section class="invite-response" aria-label="Invitation response">
					<p>Your response: <strong>{selectedEvent.responseStatus ?? 'Not yet available'}</strong></p>
					<div class="response-options">{#each Object.entries(calendarResponses) as [value, label]}<button type="button" disabled={sending} aria-pressed={reply === value} onclick={() => { reply = value as CalendarResponse; replyError = ''; replyMessage = ''; }}>{label}</button>{/each}</div>
					{#if reply}
						<form method="POST" action="?/respond" use:enhance={() => { sending = true; return async ({ result, update }) => { sending = false; await update({ reset: false }); if (result.type === 'success' && selectedEvent) { selectedEvent = { ...selectedEvent, responseStatus: String(result.data?.responseStatus) }; reply = null; replyMessage = 'Calendar response sent.'; } else if (result.type === 'failure') replyError = String(result.data?.error ?? 'Calendar response failed.'); }; }}>
							<input type="hidden" name="account" value={selectedEvent.accountEmail} /><input type="hidden" name="calendar" value={selectedEvent.calendarId} /><input type="hidden" name="event" value={selectedEvent.eventId} /><input type="hidden" name="response" value={reply} /><input type="hidden" name="confirmed" value="yes" />
							<p>Send “{calendarResponses[reply]}” for “{selectedEvent.summary}” as {selectedEvent.accountEmail}? Google will notify the guests.</p>
							<button type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send response'}</button><button type="button" disabled={sending} onclick={() => reply = null}>Cancel</button>
						</form>
					{/if}
					{#if replyError}<p role="alert">{replyError}</p>{/if}{#if replyMessage}<p role="status">{replyMessage}</p>{/if}
				</section>
			{/if}
			<div class="details-actions">
				{#if selectedEvent.htmlLink}<a href={selectedEvent.htmlLink} target="_blank" rel="noreferrer">Open in Google Calendar</a>{/if}
				<button type="button" onclick={() => dialog?.close()}>Close</button>
			</div>
		</article>
	{/if}
</dialog>

<style>
	:global(*) { box-sizing:border-box; } :global(html) { background:#07131c; color-scheme:dark; font-family:Inter,ui-sans-serif,system-ui,sans-serif; } :global(body) { margin:0; color:#edf7fb; } a { color:#6edff3; }
	.masthead { display:flex; align-items:center; gap:24px; padding:16px 24px; border-bottom:1px solid #23404e; } .brand { display:flex; gap:10px; color:#edf7fb; text-decoration:none; } .brand span { color:#6edff3; font-size:1.4rem; } nav { margin-left:auto; display:flex; gap:18px; } nav a { color:#91adb9; text-decoration:none; font-size:.85rem; } nav a.active { color:#6edff3; }
	.content { width:min(1400px,100%); margin:0 auto; padding:24px; } h1,h2,p { margin:0; }

	.toolbar { display:flex; align-items:center; gap:20px; flex-wrap:wrap; } .toolbar h1 { font-size:1.4rem; flex:1; min-width:200px; }
	.range-nav, .view-switch { display:flex; gap:4px; }
	.button { display:inline-flex; align-items:center; justify-content:center; min-width:36px; padding:7px 12px; border:1px solid #365869; border-radius:6px; background:#0d202b; color:#c9dde5; font-size:.85rem; text-decoration:none; }
	.button:hover { border-color:#6edff3; color:#edf7fb; } .button.active { background:#193a49; border-color:#6edff3; color:#a3effb; }

	.body { display:grid; grid-template-columns:240px minmax(0,1fr); gap:20px; margin-top:20px; align-items:start; }
	.calendars { position:sticky; top:16px; display:flex; flex-direction:column; gap:18px; } .account h2 { font-size:.72rem; color:#8eabb8; overflow-wrap:anywhere; flex:1; }
	.account-heading { display:flex; align-items:center; gap:6px; margin-bottom:6px; } .account-heading button { font:inherit; font-size:.68rem; padding:2px 6px; border:1px solid #365869; border-radius:4px; background:transparent; color:#91adb9; cursor:pointer; } .account-heading button:hover { color:#edf7fb; border-color:#6edff3; }
	.calendar-toggle { display:flex; align-items:center; gap:8px; padding:4px 2px; font-size:.82rem; cursor:pointer; } .calendar-toggle input { margin:0; accent-color:#6edff3; } .swatch { width:12px; height:12px; border-radius:3px; background:var(--color); flex:none; } .calendar-toggle .name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.empty { padding:24px 16px; border:1px dashed #365869; border-radius:8px; text-align:center; } .empty h2 { font-size:1rem; } .empty p { margin-top:10px; color:#8eabb8; font-size:.8rem; }

	.chip { display:flex; align-items:baseline; gap:5px; width:100%; padding:2px 6px; border:0; border-radius:4px; background:transparent; color:#dbe9ef; font:inherit; font-size:.74rem; text-align:left; cursor:pointer; overflow:hidden; }
	.chip:hover { background:#132c38; } .chip time { color:#8eabb8; flex:none; } .chip span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.chip:not(.allday)::before { content:''; width:7px; height:7px; border-radius:50%; background:var(--color); flex:none; align-self:center; }
	.chip.allday { background:var(--color); color:#07131c; font-weight:600; } .chip.allday:hover { filter:brightness(1.1); }

	.month { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); grid-template-rows:auto repeat(var(--weeks),minmax(110px,1fr)); border:1px solid #23404e; border-radius:8px; overflow:hidden; background:#23404e; gap:1px; }
	.weekday { padding:8px; background:#0b1c26; color:#8eabb8; font-size:.72rem; text-align:center; text-transform:uppercase; letter-spacing:.08em; }
	.cell { display:flex; flex-direction:column; min-width:0; padding:6px 4px; background:#0b1c26; } .cell.outside { background:#081620; } .cell.outside .day-number { color:#5e7c89; }
	.day-number { align-self:flex-end; display:grid; place-items:center; width:26px; height:26px; border-radius:50%; color:#c9dde5; font-size:.8rem; text-decoration:none; } .day-number:hover { background:#193a49; } .cell.today .day-number { background:#6edff3; color:#07131c; font-weight:700; }
	.cell ul { list-style:none; margin:4px 0 0; padding:0; display:flex; flex-direction:column; gap:2px; }

	.timegrid { display:flex; flex-direction:column; border:1px solid #23404e; border-radius:8px; overflow:hidden; background:#0b1c26; --hour:48px; --gutter:56px; }
	.grid-head, .allday-row, .scroll { display:grid; grid-template-columns:var(--gutter) repeat(var(--days),minmax(0,1fr)); }
	.grid-head { border-bottom:1px solid #23404e; } .day-head { display:flex; flex-direction:column; align-items:center; gap:2px; padding:8px 4px; color:#8eabb8; font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; text-decoration:none; border-left:1px solid #23404e; }
	.day-head strong { display:grid; place-items:center; width:30px; height:30px; border-radius:50%; color:#edf7fb; font-size:1.05rem; letter-spacing:0; } .day-head.today strong { background:#6edff3; color:#07131c; } .day-head:hover strong { background:#193a49; } .day-head.today:hover strong { background:#6edff3; }
	.allday-row { border-bottom:1px solid #23404e; min-height:28px; } .allday-row .corner { padding:6px 8px; color:#7595a3; font-size:.68rem; text-align:right; } .allday-cell { display:flex; flex-direction:column; gap:2px; padding:3px 3px; border-left:1px solid #23404e; min-width:0; }
	.scroll { max-height:calc(100vh - 260px); min-height:320px; overflow-y:auto; position:relative; }
	.hours { position:relative; height:calc(var(--hour) * 24); } .hour-label { height:var(--hour); padding:0 8px; color:#7595a3; font-size:.68rem; text-align:right; transform:translateY(-.55em); }
	.day-column { position:relative; height:calc(var(--hour) * 24); border-left:1px solid #23404e; min-width:0; } .day-column.today { background:#0d2230; } .hour-line { height:var(--hour); border-top:1px solid #1a3240; }
	.block { position:absolute; display:flex; flex-direction:column; gap:1px; padding:3px 5px; margin:0; border:0; border-left:3px solid var(--color); border-radius:4px; background:color-mix(in srgb, var(--color) 28%, #0d202b); color:#edf7fb; font:inherit; font-size:.72rem; text-align:left; cursor:pointer; overflow:hidden; box-shadow:0 0 0 1px #0b1c26; }
	.block:hover { background:color-mix(in srgb, var(--color) 45%, #0d202b); z-index:1; } .block strong { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .block span { color:#c9dde5; }
	.block.continues-before { border-top-left-radius:0; border-top-right-radius:0; } .block.continues-after { border-bottom-left-radius:0; border-bottom-right-radius:0; }
	.now-line { position:absolute; left:0; right:0; height:2px; background:#ff7a7a; pointer-events:none; z-index:2; } .now-line::before { content:''; position:absolute; left:-4px; top:-3px; width:8px; height:8px; border-radius:50%; background:#ff7a7a; }

	dialog { width:min(520px, calc(100% - 32px)); padding:0; border:1px solid #365869; border-radius:10px; background:#0d202b; color:#edf7fb; } dialog::backdrop { background:rgba(2,10,16,.7); }
	.details { padding:22px 24px; border-top:4px solid var(--color); } .details-meta { display:flex; align-items:center; gap:10px; color:#8eabb8; font-size:.72rem; } .badge { padding:3px 7px; border-radius:4px; background:var(--color); color:#07131c; font-weight:600; }
	.details h2 { margin-top:10px; font-size:1.25rem; } .when { margin-top:6px; color:#a3effb; font-size:.85rem; } .status { margin-top:4px; color:#e4c27a; font-size:.78rem; text-transform:capitalize; }
	.details p { margin-top:10px; color:#c9dde5; font-size:.82rem; overflow-wrap:anywhere; } .details p strong { color:#8eabb8; font-weight:600; margin-right:6px; }
	.description { margin:14px 0 0; padding:12px; border-radius:6px; background:#07131c; color:#c9dde5; font:inherit; font-size:.8rem; white-space:pre-wrap; overflow-wrap:anywhere; max-height:260px; overflow:auto; }
	.details-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:18px; font-size:.82rem; } .details-actions button { font:inherit; font-size:.82rem; padding:7px 14px; border:1px solid #365869; border-radius:6px; background:#0d202b; color:#c9dde5; cursor:pointer; margin-left:auto; } .details-actions button:hover { border-color:#6edff3; color:#edf7fb; }

	.invite-response { margin-top: 18px; border-top: 1px solid #365869; padding-top: 10px; } .invite-response button { margin: 8px 8px 0 0; padding: 8px 12px; background: #193a49; border: 1px solid #365869; border-radius: 5px; color: #edf7fb; cursor: pointer; } .invite-response button[aria-pressed="true"] { border-color: #6edff3; } .invite-response button:disabled { opacity: .5; }
	@media (max-width:900px) { .masthead { flex-wrap:wrap; } nav { width:100%; margin:0; overflow-x:auto; } .content { padding:16px; } .body { grid-template-columns:1fr; } .calendars { position:static; flex-direction:row; flex-wrap:wrap; gap:16px 28px; } .month { grid-template-rows:auto repeat(var(--weeks),minmax(72px,1fr)); } .chip time { display:none; } .timegrid { --gutter:44px; } .scroll { max-height:60vh; } }
</style>
