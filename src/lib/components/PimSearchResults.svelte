<script lang="ts">
  import { onMount } from 'svelte';
  import { dueLabel, markdownPreview, noteLabel } from '$lib/pim';
  import { searchPim } from '$lib/pim.remote';
  import { onStateChange } from '$lib/state-change';
  import Icon from './Icon.svelte';

  let { query }: { query: string } = $props();
  let results = $derived(await searchPim(query));
  let total = $derived(results.notes.length + results.todos.length);

  onMount(() =>
    onStateChange(async (scopes) => {
      if (scopes.has('pim')) await searchPim(query).refresh();
    })
  );
</script>

{#if total > 0}
  <details class="pim-results" open>
    <summary>Notes and to-dos · {total}</summary>
    <ul>
      {#each results.todos as todo (`todo:${todo.id}`)}
        <li>
          <a href={`/todos?todo=${todo.id}`}>
            <Icon name="todo" />
            <span class="text">
              <strong class:done={todo.completedAt !== null}>{todo.title}</strong>
              <small
                >To-do{todo.completedAt ? ' · Completed' : ''}{todo.dueDate
                  ? ` · ${dueLabel(todo)}`
                  : ''}</small
              >
            </span>
          </a>
        </li>
      {/each}
      {#each results.notes as note (`note:${note.id}`)}
        <li>
          <a href={`/notes?note=${note.id}`}>
            <Icon name="note" />
            <span class="text">
              <strong>{noteLabel(note)}</strong>
              <small>Note · {markdownPreview(note.body)}</small>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .pim-results {
    max-height: 40vh;
    overflow-y: auto;
    border-bottom: 1px solid var(--color-border);
  }
  summary {
    padding: 8px 16px;
    color: var(--color-accent-text);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  ul {
    margin: 0;
    padding: 0 0 6px;
    list-style: none;
  }
  a {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    padding: 6px 16px;
    color: var(--color-text-muted);
    text-decoration: none;
  }
  a:hover {
    background: var(--color-surface-hover);
  }
  .text {
    display: grid;
    min-width: 0;
  }
  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  strong {
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  strong.done {
    text-decoration: line-through;
  }
  small {
    font-size: var(--text-xs);
  }
</style>
