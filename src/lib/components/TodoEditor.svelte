<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { AUTOSAVE_DELAY_MS } from '$lib/composer';
  import { commandError, type PimCategory, type Todo } from '$lib/pim';
  import { updateTodoCommand } from '$lib/pim.remote';
  import { showToast } from '$lib/toast.svelte';
  import RichTextEditor from './RichTextEditor.svelte';

  type Change = {
    title?: string;
    description?: string;
    categoryId?: number | null;
    dueDate?: string | null;
    dueTime?: string | null;
    completed?: boolean;
  };

  let {
    todo,
    categories,
    ondelete,
  }: { todo: Todo; categories: PimCategory[]; ondelete: () => void } = $props();

  const id = untrack(() => todo.id);
  const initialDescription = untrack(() => todo.description);
  // Only changed fields are sent, so a change from another place to other fields stays.
  let changes = $state<Change>({});
  let saved = $state<Todo | null>(null);
  let saving = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The newest saved state: this editor's last save, or the list data after a refresh.
  let base = $derived(saved && saved.updatedAt > todo.updatedAt ? saved : todo);
  let title = $derived(changes.title ?? base.title);
  let categoryId = $derived(
    changes.categoryId === undefined ? base.categoryId : changes.categoryId
  );
  let dueDate = $derived(changes.dueDate === undefined ? base.dueDate : changes.dueDate);
  let dueTime = $derived(changes.dueTime === undefined ? base.dueTime : changes.dueTime);
  let completed = $derived(changes.completed ?? base.completedAt !== null);
  let pending = $derived(Object.keys(changes).length > 0);

  function change(value: Change, now = false) {
    changes = { ...changes, ...value };
    clearTimeout(timer);
    if (now) void save();
    else timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  }

  async function save() {
    clearTimeout(timer);
    if (saving || !pending) return;
    // A blank title fails validation, so the save waits for the user to enter one.
    if (changes.title !== undefined && !changes.title.trim()) return;
    const sent = changes;
    saving = true;
    let ok = false;
    try {
      saved = await updateTodoCommand({ id, ...sent });
      ok = true;
      // Keep the fields that changed again during the save.
      const rest: Change = {};
      for (const [key, value] of Object.entries(changes) as [keyof Change, unknown][])
        if (sent[key] !== value) Object.assign(rest, { [key]: value });
      changes = rest;
    } catch (error) {
      showToast(`The to-do was not saved. ${commandError(error)}`, { tone: 'error' });
    } finally {
      saving = false;
    }
    // After a failure, the next edit or blur tries again.
    if (ok && Object.keys(changes).length) change({});
  }

  onDestroy(() => void save());
</script>

<article class="todo-editor" onfocusout={() => void save()}>
  <div class="heading">
    <input
      type="checkbox"
      checked={completed}
      aria-label="Completed"
      onchange={(event) => change({ completed: event.currentTarget.checked }, true)}
    />
    <input
      class="title"
      value={title}
      oninput={(event) => change({ title: event.currentTarget.value })}
      placeholder="Title"
      aria-label="To-do title"
    />
  </div>
  {#if !title.trim()}<p class="hint" role="alert">Enter a title to save.</p>{/if}
  <div class="fields">
    <label
      >Category
      <select
        value={categoryId === null ? '' : String(categoryId)}
        onchange={(event) =>
          change(
            { categoryId: event.currentTarget.value ? Number(event.currentTarget.value) : null },
            true
          )}
      >
        <option value="">Uncategorized</option>
        {#each categories as category (category.id)}<option value={String(category.id)}
            >{category.name}</option
          >{/each}
      </select></label
    >
    <label
      >Due date
      <input
        type="date"
        value={dueDate ?? ''}
        onchange={(event) => {
          const value = event.currentTarget.value || null;
          change(value ? { dueDate: value } : { dueDate: null, dueTime: null }, true);
        }}
      /></label
    >
    <label
      >Time
      <input
        type="time"
        value={dueTime ?? ''}
        disabled={!dueDate}
        onchange={(event) => change({ dueTime: event.currentTarget.value || null }, true)}
      /></label
    >
    {#if dueDate}<button
        type="button"
        class="clear"
        onclick={() => change({ dueDate: null, dueTime: null }, true)}>No due date</button
      >{/if}
  </div>
  <p class="label">Description</p>
  <RichTextEditor
    markdown={initialDescription}
    label="To-do description"
    onchange={(value) => change({ description: value })}
  />
  <footer>
    <span class="status" aria-live="polite"
      >{saving ? 'Saving…' : pending ? 'Changes not saved' : 'Saved'}</span
    >
    {#if base.sourceEmailId}<a href={`/?message=${base.sourceEmailId}`}>Open source email</a>{/if}
    <button type="button" class="danger" onclick={ondelete}>Delete to-do</button>
  </footer>
</article>

<style>
  .todo-editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .heading {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .heading input[type='checkbox'] {
    width: 20px;
    height: 20px;
    accent-color: var(--color-accent);
  }
  .title {
    flex: 1;
    min-width: 0;
    padding: 6px 0;
    border: 0;
    border-bottom: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    font-size: 1.3rem;
    font-weight: 650;
  }
  .title:focus {
    outline: none;
    border-bottom-color: var(--color-accent);
  }
  .hint {
    margin: 0;
    color: var(--color-caution);
    font-size: var(--text-xs);
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px;
  }
  label,
  .label {
    display: grid;
    gap: 4px;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  select,
  input[type='date'],
  input[type='time'],
  button {
    padding: 6px 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  button {
    cursor: pointer;
  }
  .todo-editor :global(.rich-editor) {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  footer a {
    color: var(--color-accent);
    font-size: var(--text-sm);
  }
  .status {
    flex: 1;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .danger {
    color: var(--color-danger);
  }
</style>
