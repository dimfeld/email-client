<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import AppMasthead from '$lib/components/AppMasthead.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import PimCategoryNav, {
    categoryKey,
    type CategoryKey,
  } from '$lib/components/PimCategoryNav.svelte';
  import TodoEditor from '$lib/components/TodoEditor.svelte';
  import { dateKeyFromDate } from '$lib/calendar';
  import {
    commandError,
    compareDue,
    dropIndex,
    dueLabel,
    isOverdue,
    moveId,
    type Todo,
  } from '$lib/pim';
  import {
    createTodoCommand,
    deleteTodoCommand,
    getPimCategories,
    getTodos,
    reorderTodosCommand,
    updateTodoCommand,
  } from '$lib/pim.remote';
  import { onStateChange } from '$lib/state-change';
  import { showToast } from '$lib/toast.svelte';

  type Group = { key: CategoryKey; name: string; todos: Todo[]; sortable: boolean };

  let search = $derived(page.url.searchParams.get('q')?.trim() ?? '');
  /** A category key, or `scheduled` for open to-dos with a due date. */
  let view = $derived(page.url.searchParams.get('category') ?? 'all');
  let selectedId = $derived(Number(page.url.searchParams.get('todo')) || null);
  let categories = $derived(await getPimCategories());
  let todos = $derived(await getTodos(search));
  let now = $state(new Date());
  // Orders from a drag or a move that the server has not confirmed yet.
  const orders = new SvelteMap<CategoryKey, number[]>();
  let drag = $state<{ key: CategoryKey; id: number; start: number[]; ids: number[] } | null>(null);
  let newTitle = $state('');

  let categoryNames = $derived(new Map(categories.map((category) => [category.id, category.name])));
  let openTodos = $derived(todos.filter((todo) => todo.completedAt === null));
  let counts = $derived.by(() => {
    const result: Record<CategoryKey, number> = { all: 0, scheduled: 0 };
    for (const todo of openTodos) {
      const key = categoryKey(todo.categoryId);
      result[key] = (result[key] ?? 0) + 1;
      result.all++;
      if (todo.dueDate) result.scheduled++;
    }
    return result;
  });
  let inView = $derived.by(() => {
    const current = view;
    return (todo: Todo) =>
      current === 'all' ||
      (current === 'scheduled' ? todo.dueDate !== null : categoryKey(todo.categoryId) === current);
  });
  let groups = $derived.by((): Group[] => {
    // Locals, because reads of deriveds inside a loop can freeze the page in async mode.
    const current = view;
    const names = categoryNames;
    const visible = openTodos.filter(inView);
    // Search results are a subset, so their order cannot become the category order.
    const sortable = !search;
    if (current === 'scheduled')
      return [
        {
          key: 'scheduled',
          name: 'Scheduled',
          todos: [...visible].sort(compareDue),
          sortable: false,
        },
      ];
    const keys = ['none', ...categories.map((category) => String(category.id))].filter(
      (key) => current === 'all' || key === current
    );
    const override = drag ? { [drag.key]: drag.ids } : {};
    return keys.flatMap((key) => {
      const members = visible.filter((todo) => categoryKey(todo.categoryId) === key);
      if (current === 'all' && members.length === 0) return [];
      const order = override[key] ?? orders.get(key);
      if (order) {
        const rank = new Map(order.map((id, index) => [id, index]));
        members.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
      }
      const name = key === 'none' ? 'Uncategorized' : (names.get(Number(key)) ?? '');
      return [{ key, name, todos: members, sortable }];
    });
  });
  let completedTodos = $derived(
    todos
      .filter((todo) => todo.completedAt !== null && inView(todo))
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  );
  let selected = $derived(todos.find((todo) => todo.id === selectedId) ?? null);

  function href(change: { category?: string; todo?: number | null }) {
    const url = new URL(page.url);
    if (change.category !== undefined) {
      if (change.category === 'all') url.searchParams.delete('category');
      else url.searchParams.set('category', change.category);
    }
    if (change.todo !== undefined) {
      if (change.todo) url.searchParams.set('todo', String(change.todo));
      else url.searchParams.delete('todo');
    }
    return `${url.pathname}${url.search}`;
  }

  const categoryIdOf = (key: CategoryKey) => (key === 'none' ? null : Number(key));

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const current = view;
    try {
      await createTodoCommand({
        title: newTitle,
        categoryId: current === 'all' || current === 'scheduled' ? null : categoryIdOf(current),
        dueDate: current === 'scheduled' ? dateKeyFromDate(new Date()) : null,
      });
      newTitle = '';
      await getTodos(search).refresh();
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    }
  }

  async function setCompleted(todo: Todo, completed: boolean) {
    try {
      await updateTodoCommand({ id: todo.id, completed });
      await getTodos(search).refresh();
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    }
  }

  async function remove() {
    const todo = selected;
    if (!todo || !confirm(`Delete “${todo.title}”?`)) return;
    try {
      await deleteTodoCommand(todo.id);
      await goto(href({ todo: null }), { noScroll: true });
      await getTodos(search).refresh();
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    }
  }

  async function saveOrder(key: CategoryKey, ids: number[]) {
    orders.set(key, ids);
    try {
      await reorderTodosCommand({ categoryId: categoryIdOf(key), ids });
      await getTodos(search).refresh();
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    } finally {
      if (orders.get(key) === ids) orders.delete(key);
    }
  }

  function startDrag(event: PointerEvent, group: Group, id: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const ids = group.todos.map((todo) => todo.id);
    drag = { key: group.key, id, start: ids, ids };
  }

  function moveDrag(event: PointerEvent) {
    if (!drag) return;
    const list = (event.currentTarget as HTMLElement).closest('ul');
    if (!list) return;
    const middles = [...list.querySelectorAll<HTMLElement>(':scope > li[data-id]')]
      .filter((row) => Number(row.dataset.id) !== drag!.id)
      .map((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
    const ids = moveId(drag.ids, drag.id, dropIndex(middles, event.clientY));
    if (ids.some((id, index) => id !== drag!.ids[index])) drag.ids = ids;
  }

  function endDrag() {
    if (!drag) return;
    const { key, start, ids } = drag;
    drag = null;
    if (ids.some((id, index) => id !== start[index])) void saveOrder(key, ids);
  }

  // Arrow keys on the handle move the to-dos one place, for keyboard users.
  function keyMove(event: KeyboardEvent, group: Group, id: number) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const ids = group.todos.map((todo) => todo.id);
    const index = ids.indexOf(id) + (event.key === 'ArrowUp' ? -1 : 1);
    if (index < 0 || index >= ids.length) return;
    void saveOrder(group.key, moveId(ids, id, index));
  }

  onMount(() => {
    // Overdue labels change as time passes.
    const clock = setInterval(() => (now = new Date()), 60_000);
    const stop = onStateChange(async (scopes) => {
      if (!scopes.has('pim')) return;
      await Promise.all([getTodos(search).refresh(), getPimCategories().refresh()]);
    });
    return () => {
      clearInterval(clock);
      stop();
    };
  });
</script>

<svelte:head><title>To-dos — Email Check</title></svelte:head>

{#snippet row(todo: Todo, group: Group | null)}
  {@const due = dueLabel(todo, now)}
  <li
    data-id={todo.id}
    class:dragging={drag?.id === todo.id}
    class:done={todo.completedAt !== null}
  >
    {#if group?.sortable}
      <button
        type="button"
        class="handle"
        aria-label={`Move “${todo.title}”. Drag, or use the up and down arrow keys.`}
        title="Drag to reorder"
        onpointerdown={(event) => startDrag(event, group, todo.id)}
        onpointermove={moveDrag}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        onkeydown={(event) => keyMove(event, group, todo.id)}><Icon name="grip" /></button
      >
    {/if}
    <input
      type="checkbox"
      checked={todo.completedAt !== null}
      aria-label={`Complete “${todo.title}”`}
      onchange={(event) => setCompleted(todo, event.currentTarget.checked)}
    />
    <a
      href={href({ todo: todo.id })}
      class:active={todo.id === selectedId}
      aria-current={todo.id === selectedId ? 'true' : undefined}
      data-sveltekit-noscroll
    >
      <span class="title">{todo.title}</span>
      <span class="meta">
        {#if due}<span class:overdue={isOverdue(todo, now)}
            ><Icon name="clock" size="0.9em" /> {due}</span
          >{/if}
        {#if view === 'scheduled' || search || group === null}<span
            >{todo.categoryId === null ? 'Uncategorized' : categoryNames.get(todo.categoryId)}</span
          >{/if}
        {#if todo.description.trim()}<span title="Has a description"
            ><Icon name="note" size="0.9em" /></span
          >{/if}
        {#if todo.sourceEmailId}<span>From email</span>{/if}
      </span>
    </a>
  </li>
{/snippet}

<main>
  <AppMasthead active="/todos" />
  <section class="todos" class:detail-open={selected !== null}>
    <PimCategoryNav
      label="To-do categories"
      {categories}
      {counts}
      selected={view}
      href={(category) => href({ category, todo: null })}
    >
      {#snippet views()}
        <a
          href={href({ category: 'scheduled', todo: null })}
          aria-current={view === 'scheduled' ? 'page' : undefined}
          ><span>Scheduled</span><small>{counts.scheduled ?? 0}</small></a
        >
      {/snippet}
    </PimCategoryNav>
    <div class="list-pane">
      <div class="list-tools">
        <form method="GET" class="search">
          {#if view !== 'all'}<input type="hidden" name="category" value={view} />{/if}
          <input
            type="search"
            name="q"
            value={search}
            placeholder="Search to-dos"
            aria-label="Search to-dos"
          />
          <button type="submit" aria-label="Search"><Icon name="search" /></button>
        </form>
        <form class="add" onsubmit={add}>
          <input
            bind:value={newTitle}
            placeholder={view === 'scheduled' ? 'Add a to-do for today' : 'Add a to-do'}
            aria-label="New to-do title"
          />
          <button type="submit" class="primary" disabled={!newTitle.trim()}>Add</button>
        </form>
      </div>
      <div class="list">
        {#each groups as group (group.key)}
          <section aria-label={group.name}>
            {#if view === 'all'}<h2>{group.name}</h2>{/if}
            <ul>
              {#each group.todos as todo (todo.id)}{@render row(todo, group)}{:else}
                <li class="empty">
                  {search ? `No open to-dos match “${search}”.` : 'No open to-dos here.'}
                </li>
              {/each}
            </ul>
          </section>
        {:else}
          <p class="empty">{search ? `No open to-dos match “${search}”.` : 'No open to-dos.'}</p>
        {/each}
        {#if completedTodos.length}
          <details class="completed">
            <summary>Completed · {completedTodos.length}</summary>
            <ul>
              {#each completedTodos as todo (todo.id)}{@render row(todo, null)}{/each}
            </ul>
          </details>
        {/if}
      </div>
    </div>
    <div class="detail-pane">
      {#if selected}
        <a class="back" href={href({ todo: null })}><Icon name="chevron-left" /> To-dos</a>
        {#key selected.id}
          <TodoEditor todo={selected} {categories} ondelete={remove} />
        {/key}
      {:else}
        <p class="placeholder">Select a to-do to see its details.</p>
      {/if}
    </div>
  </section>
</main>

<style>
  .todos {
    display: grid;
    grid-template-columns: 200px minmax(320px, 1fr) minmax(0, 1.2fr);
    height: calc(100vh - 61px);
  }
  .todos > :global(nav) {
    border-right: 1px solid var(--color-border);
  }
  .list-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .list-tools {
    display: grid;
    gap: 8px;
    padding: 14px;
  }
  .search,
  .add {
    display: flex;
    gap: 6px;
  }
  .list-tools input {
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
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 24px;
  }
  h2 {
    margin: 12px 14px 4px;
    color: var(--color-accent-text);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px 0 6px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  li.dragging {
    position: relative;
    z-index: 1;
    background: var(--color-surface-raised);
    box-shadow: 0 4px 14px var(--color-shadow);
  }
  li input[type='checkbox'] {
    flex: none;
    width: 18px;
    height: 18px;
    margin-left: 8px;
    accent-color: var(--color-accent);
  }
  .handle {
    flex: none;
    padding: 6px 2px;
    border: 0;
    background: transparent;
    color: var(--color-text-faint);
    cursor: grab;
    touch-action: none;
  }
  li.dragging .handle {
    cursor: grabbing;
  }
  li a {
    display: grid;
    flex: 1;
    gap: 2px;
    min-width: 0;
    padding: 10px 6px;
    border-radius: var(--radius-sm);
    color: var(--color-text);
    text-decoration: none;
  }
  li a:hover {
    background: var(--color-surface-hover);
  }
  li a.active {
    background: var(--color-accent-bg);
  }
  .title {
    overflow: hidden;
    font-size: 0.92rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li.done .title {
    color: var(--color-text-muted);
    text-decoration: line-through;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .meta:empty {
    display: none;
  }
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .overdue {
    color: var(--color-danger);
  }
  .empty {
    display: block;
    padding: 20px 14px;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-align: center;
  }
  .completed summary {
    padding: 14px;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    cursor: pointer;
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
    .todos {
      grid-template-columns: 1fr;
      align-content: start;
      height: auto;
      min-height: calc(100vh - 61px);
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
