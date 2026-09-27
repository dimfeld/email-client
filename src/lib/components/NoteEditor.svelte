<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { AUTOSAVE_DELAY_MS } from '$lib/composer';
  import { commandError, type Note, type PimCategory } from '$lib/pim';
  import { updateNoteCommand } from '$lib/pim.remote';
  import { showToast } from '$lib/toast.svelte';
  import RichTextEditor from './RichTextEditor.svelte';

  let {
    note,
    categories,
    ondelete,
    onreload,
  }: {
    /** The saved note. The editor starts from it and later compares revisions with it. */
    note: Note;
    categories: PimCategory[];
    ondelete: () => void;
    /** Replaces this editor with one for the latest saved note. */
    onreload: () => void;
  } = $props();

  const initial = untrack(() => note);
  let title = $state(initial.title);
  let body = $state(initial.body);
  let categoryId = $state(initial.categoryId);
  let revision = $state(initial.revision);
  let dirty = $state(false);
  let saving = $state(false);
  let conflict = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A change from another place, for example the chat, while this editor is open.
  let changedElsewhere = $derived(conflict || (note.revision > revision && !saving));

  function changed() {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  }

  async function save() {
    clearTimeout(timer);
    if (!dirty || saving || conflict) return;
    saving = true;
    dirty = false;
    let ok = false;
    try {
      const saved = await updateNoteCommand({
        id: initial.id,
        revision,
        title,
        body,
        categoryId,
      });
      revision = saved.revision;
      ok = true;
    } catch (error) {
      dirty = true;
      if ((error as { status?: number } | null)?.status === 409) conflict = true;
      else showToast(`The note was not saved. ${commandError(error)}`, { tone: 'error' });
    } finally {
      saving = false;
    }
    // Edits during the save need one more save. After a failure, the next edit or blur tries again.
    if (ok && dirty) changed();
  }

  onDestroy(() => void save());
</script>

<article class="note-editor" onfocusout={() => void save()}>
  {#if changedElsewhere}
    <p class="conflict" role="alert">
      This note changed in another place.
      {#if dirty}Your latest edits are not saved.{/if}
      <button type="button" onclick={onreload}>Load the latest version</button>
    </p>
  {/if}
  <div class="fields">
    <input
      class="title"
      bind:value={title}
      oninput={changed}
      placeholder="Title"
      aria-label="Note title"
    />
    <select
      aria-label="Category"
      value={categoryId === null ? '' : String(categoryId)}
      onchange={(event) => {
        categoryId = event.currentTarget.value ? Number(event.currentTarget.value) : null;
        changed();
        void save();
      }}
    >
      <option value="">Uncategorized</option>
      {#each categories as category (category.id)}<option value={String(category.id)}
          >{category.name}</option
        >{/each}
    </select>
  </div>
  <RichTextEditor
    markdown={initial.body}
    label="Note text"
    onchange={(value) => {
      body = value;
      changed();
    }}
  />
  <footer>
    <span class="status" aria-live="polite"
      >{saving ? 'Saving…' : dirty ? 'Changes not saved' : 'Saved'}</span
    >
    <button type="button" class="danger" onclick={ondelete}>Delete note</button>
  </footer>
</article>

<style>
  .note-editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .title {
    flex: 1;
    min-width: 200px;
    padding: 6px 0;
    border: 0;
    border-bottom: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    font-size: 1.4rem;
    font-weight: 650;
  }
  .title:focus {
    outline: none;
    border-bottom-color: var(--color-accent);
  }
  select,
  button {
    padding: 6px 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .note-editor :global(.rich-editor) {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .note-editor :global(.editor-content) {
    min-height: 50vh;
  }
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .status {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .danger {
    color: var(--color-danger);
  }
  .conflict {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--color-caution);
    border-radius: var(--radius-md);
    background: var(--color-warning-bg);
    font-size: var(--text-sm);
  }
</style>
