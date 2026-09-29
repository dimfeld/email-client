<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import AppMasthead from '$lib/components/AppMasthead.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import NoteEditor from '$lib/components/NoteEditor.svelte';
  import PimCategoryNav, {
    categoryKey,
    type CategoryKey,
  } from '$lib/components/PimCategoryNav.svelte';
  import { commandError, markdownPreview, noteLabel } from '$lib/pim';
  import {
    createNoteCommand,
    deleteNoteCommand,
    getNotes,
    getPimCategories,
  } from '$lib/pim.remote';
  import { onStateChange } from '$lib/state-change';
  import { showToast } from '$lib/toast.svelte';

  let search = $derived(page.url.searchParams.get('q')?.trim() ?? '');
  let selectedKey = $derived<CategoryKey>(page.url.searchParams.get('category') ?? 'all');
  let selectedId = $derived(Number(page.url.searchParams.get('note')) || null);
  let categories = $derived(await getPimCategories());
  let notes = $derived(await getNotes(search));
  let counts = $derived.by(() => {
    const result: Record<CategoryKey, number> = { all: notes.length };
    for (const note of notes) {
      const key = categoryKey(note.categoryId);
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  });
  let visibleNotes = $derived.by(() => {
    const key = selectedKey;
    return key === 'all' ? notes : notes.filter((note) => categoryKey(note.categoryId) === key);
  });
  let selected = $derived(notes.find((note) => note.id === selectedId) ?? null);
  let categoryNames = $derived(new Map(categories.map((category) => [category.id, category.name])));
  // Goes up when the user loads a note that changed in another place.
  let reloads = $state(0);

  function href(change: { category?: CategoryKey; note?: number | null; q?: string }) {
    const url = new URL(page.url);
    const set = (name: string, value: string | null) =>
      value ? url.searchParams.set(name, value) : url.searchParams.delete(name);
    if (change.category !== undefined)
      set('category', change.category === 'all' ? null : change.category);
    if (change.note !== undefined) set('note', change.note ? String(change.note) : null);
    if (change.q !== undefined) set('q', change.q);
    return `${url.pathname}${url.search}`;
  }

  async function newNote() {
    const key = selectedKey;
    try {
      const note = await createNoteCommand({
        title: '',
        body: '',
        categoryId: key === 'all' || key === 'none' ? null : Number(key),
      });
      await getNotes('').refresh();
      await goto(href({ note: note.id, q: '' }), { noScroll: true });
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    }
  }

  async function remove() {
    const note = selected;
    if (!note || !confirm(`Delete “${noteLabel(note)}”?`)) return;
    try {
      await deleteNoteCommand(note.id);
      await goto(href({ note: null }), { noScroll: true });
      await getNotes(search).refresh();
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    }
  }

  onMount(() =>
    onStateChange(async (scopes) => {
      if (!scopes.has('pim')) return;
      await Promise.all([getNotes(search).refresh(), getPimCategories().refresh()]);
    })
  );
</script>

<svelte:head><title>Notes — Email Check</title></svelte:head>

<main>
  <AppMasthead active="/notes" />
  <section class="notes" class:detail-open={selected !== null}>
    <PimCategoryNav
      label="Note categories"
      {categories}
      {counts}
      selected={selectedKey}
      href={(category) => href({ category, note: null })}
    />
    <div class="list-pane">
      <div class="list-tools">
        <form method="GET" class="search">
          {#if selectedKey !== 'all'}<input
              type="hidden"
              name="category"
              value={selectedKey}
            />{/if}
          <input
            type="search"
            name="q"
            value={search}
            placeholder="Search notes"
            aria-label="Search notes"
          />
          <button type="submit" aria-label="Search"><Icon name="search" /></button>
        </form>
        <button type="button" class="primary" onclick={newNote}>New note</button>
      </div>
      <ul class="list" aria-label="Notes">
        {#each visibleNotes as note (note.id)}
          <li>
            <a
              href={href({ note: note.id })}
              class:active={note.id === selectedId}
              aria-current={note.id === selectedId ? 'true' : undefined}
              data-sveltekit-noscroll
            >
              <strong>{noteLabel(note)}</strong>
              <span class="preview">{markdownPreview(note.body)}</span>
              <small
                >{new Date(
                  note.updatedAt
                ).toLocaleDateString()}{#if selectedKey === 'all' && note.categoryId !== null}
                  · {categoryNames.get(note.categoryId)}{/if}</small
              >
            </a>
          </li>
        {:else}
          <li class="empty">
            {search ? `No notes match “${search}”.` : 'No notes here yet.'}
          </li>
        {/each}
      </ul>
    </div>
    <div class="detail-pane">
      {#if selected}
        <a class="back" href={href({ note: null })}><Icon name="chevron-left" /> Notes</a>
        {#key `${selected.id}:${reloads}`}
          <NoteEditor
            note={selected}
            {categories}
            ondelete={remove}
            onreload={async () => {
              await getNotes(search).refresh();
              reloads++;
            }}
          />
        {/key}
      {:else}
        <p class="placeholder">Select a note, or create a new note.</p>
      {/if}
    </div>
  </section>
</main>

<style>
  .notes {
    display: grid;
    grid-template-columns: 200px 300px minmax(0, 1fr);
    height: calc(100vh - 61px);
  }
  .notes > :global(nav) {
    border-right: 1px solid var(--color-border);
  }
  .list-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .list-tools {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
  }
  .search {
    display: flex;
    gap: 6px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
  }
  button {
    padding: 8px 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .primary {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-on-accent);
    font-weight: 600;
  }
  .list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  .list a {
    display: grid;
    gap: 3px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text);
    text-decoration: none;
  }
  .list a:hover {
    background: var(--color-surface-hover);
  }
  .list a.active {
    background: var(--color-accent-bg);
  }
  .list strong,
  .preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list strong {
    font-size: 0.92rem;
  }
  .preview {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .list small {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .empty {
    padding: 24px 14px;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-align: center;
  }
  .detail-pane {
    min-width: 0;
    min-height: 0;
    padding: 24px 32px;
    overflow-y: auto;
  }
  .placeholder {
    display: grid;
    place-items: center;
    height: 100%;
    margin: 0;
    color: var(--color-text-muted);
  }
  .back {
    display: none;
    margin-bottom: 16px;
    color: var(--color-accent);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  @media (max-width: 760px) {
    .notes {
      grid-template-columns: 1fr;
      align-content: start;
      height: auto;
      min-height: calc(100vh - 61px - var(--app-inset-top, 0px));
    }
    .list {
      overflow: visible;
    }
    .detail-pane,
    .detail-open .list-pane,
    .detail-open > :global(nav) {
      display: none;
    }
    .detail-open .detail-pane {
      display: block;
      padding: 16px;
    }
    .back {
      display: inline-flex;
    }
  }
</style>
