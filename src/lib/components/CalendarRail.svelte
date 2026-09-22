<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { addDays, dateKeyFromDate, eventsOnDay, layoutTimedEvents } from '$lib/calendar';
	import type { SyncedCalendarEvent } from '$lib/server/types';

	let { events, day }: { events: SyncedCalendarEvent[]; day: string } = $props();
	function changeDay(day: string) {
		const url = new URL(page.url);
		url.searchParams.set('day', day);
		void goto(url, { noScroll: true, keepFocus: true });
	}
	let scroller: HTMLDivElement;
	const hours = Array.from({ length: 24 }, (_, hour) => hour);
	let placements = $derived(layoutTimedEvents(events, day));
	let allDay = $derived(eventsOnDay(events, day).filter((event) => event.allDay));
	onMount(() => { scroller.scrollTop = new Date().getHours() * 52; });
</script>

<aside aria-label="Daily calendar">
	<header><a href="/calendar">Calendar</a><a href="/contacts">Contacts</a></header>
	<div class="day-heading">
		<strong>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00`))}</strong>
		<button aria-label="Previous day" onclick={() => changeDay(addDays(day, -1))}>←</button>
		<button aria-label="Today" onclick={() => changeDay(dateKeyFromDate(new Date()))}>•</button>
		<button aria-label="Next day" onclick={() => changeDay(addDays(day, 1))}>→</button>
	</div>
	{#each allDay as event}<a class="all-day" href={`/calendar?view=day&date=${day}`}>{event.summary}</a>{/each}
	<div class="scroll" bind:this={scroller}>
		<div class="hours">
			{#each hours as hour}<div class="hour"><span>{new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour))}</span></div>{/each}
			{#each placements as item}
				<a class="event" style:left={`calc(38px + (100% - 48px) * ${item.column / item.columns})`} style:width={`calc((100% - 48px) / ${item.columns})`} style:top={`${item.startMinutes / 60 * 52}px`} style:height={`${(item.endMinutes - item.startMinutes) / 60 * 52}px`} href={`/calendar?view=day&date=${day}`} title={item.event.summary}>{item.event.summary}</a>
			{/each}
		</div>
	</div>
</aside>

<style>
	aside { min-width: 0; display: flex; flex-direction: column; background: #0c0c0e; font-size: .72rem; overflow: hidden; }
	header { display: flex; gap: 20px; padding: 16px 12px; }
	a { color: #33b4eb; text-decoration: none; }
	.day-heading { display: flex; align-items: center; gap: 6px; padding: 12px; color: #949499; }
	strong { margin-right: auto; font-size: .65rem; text-transform: uppercase; }
	button { background: none; border: 0; color: #aaa; cursor: pointer; }
	.scroll { overflow-y: auto; flex: 1; }
	.hours { position: relative; padding-left: 38px; }
	.hour { height: 52px; border-top: 1px solid #252528; margin-right: 10px; }
	.hour span { position: absolute; left: 6px; color: #777; font-size: .6rem; }
	.event { position: absolute;  min-height: 16px; padding: 2px 5px; border-radius: 4px; color: #ead9dc; background: #553739; overflow: hidden; }
	.all-day { margin: 2px 10px 8px; padding: 4px; background: #163d4c; border-radius: 4px; }
</style>
