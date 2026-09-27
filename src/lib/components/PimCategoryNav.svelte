<script lang="ts" module>
  /** `all`, `none` for items without a category, or a category ID. */
  export type CategoryKey = string;

  export function categoryKey(categoryId: number | null): CategoryKey {
    return categoryId === null ? 'none' : String(categoryId);
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { commandError, type PimCategory } from '$lib/pim';
  import { showToast } from '$lib/toast.svelte';
  import {
    createPimCategoryCommand,
    deletePimCategoryCommand,
    getPimCategories,
    renamePimCategoryCommand,
  } from '$lib/pim.remote';

  let {
    label,
    categories,
    counts,
    selected,
    href,
    views,
  }: {
    /** The accessible name, for example "Note categories". */
    label: string;
    categories: PimCategory[];
    counts: Record<CategoryKey, number>;
    selected: CategoryKey;
    href: (key: CategoryKey) => string;
    /** More views after "All", for example "Scheduled". */
    views?: Snippet;
  } = $props();

  let newName = $state('');
  let renaming = $state(false);
  let renameValue = $state('');
  let selectedCategory = $derived(categories.find((category) => String(category.id) === selected));

  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const category = await createPimCategoryCommand(newName);
      newName = '';
      await getPimCategories().refresh();
      await goto(href(String(category.id)), { keepFocus: true, noScroll: true });
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    }
  }

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedCategory) return;
    try {
      await renamePimCategoryCommand({ id: selectedCategory.id, name: renameValue });
      renaming = false;
      await getPimCategories().refresh();
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    }
  }

  async function remove() {
    const category = selectedCategory;
    if (
      !category ||
      !confirm(`Delete the category “${category.name}”? Its notes and to-dos stay, uncategorized.`)
    )
      return;
    try {
      await deletePimCategoryCommand(category.id);
      await getPimCategories().refresh();
      await goto(href('all'), { keepFocus: true, noScroll: true });
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    }
  }
</script>

<nav class="categories" aria-label={label}>
  <a href={href('all')} aria-current={selected === 'all' ? 'page' : undefined}
    ><span>All</span><small>{counts.all ?? 0}</small></a
  >
  {@render views?.()}
  <p class="eyebrow">CATEGORIES</p>
  {#each categories as category (category.id)}
    {@const key = String(category.id)}
    <a href={href(key)} aria-current={selected === key ? 'page' : undefined}
      ><span>{category.name}</span><small>{counts[key] ?? 0}</small></a
    >
  {/each}
  <a href={href('none')} aria-current={selected === 'none' ? 'page' : undefined}
    ><span>Uncategorized</span><small>{counts.none ?? 0}</small></a
  >
  <form class="add" onsubmit={create}>
    <input bind:value={newName} placeholder="New category" aria-label="New category name" />
    <button type="submit" disabled={!newName.trim()}>Add</button>
  </form>
  {#if selectedCategory}
    <div class="manage">
      {#if renaming}
        <form onsubmit={rename}>
          <input bind:value={renameValue} aria-label="Category name" />
          <button type="submit">Save</button>
          <button type="button" onclick={() => (renaming = false)}>Cancel</button>
        </form>
      {:else}
        <button
          type="button"
          onclick={() => {
            renameValue = selectedCategory!.name;
            renaming = true;
          }}>Rename</button
        >
        <button type="button" class="danger" onclick={remove}>Delete category</button>
      {/if}
    </div>
  {/if}
</nav>

<style>
  .categories {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 10px;
    min-width: 0;
    overflow-y: auto;
  }
  .eyebrow {
    margin: 16px 8px 6px;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
  }
  .categories :global(a) {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 8px;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .categories :global(a:hover) {
    background: var(--color-surface-hover);
  }
  .categories :global(a[aria-current='page']) {
    background: var(--color-accent-bg);
    color: var(--color-accent-text);
  }
  .categories :global(a span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .categories :global(small) {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .add {
    margin-top: 10px;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-sunken);
    color: var(--color-text);
    font-size: var(--text-sm);
  }
  button {
    padding: 6px 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .manage {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .danger {
    color: var(--color-danger);
  }
  @media (max-width: 760px) {
    .categories {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid var(--color-border);
    }
    .eyebrow {
      display: none;
    }
    .add,
    .manage {
      margin-top: 0;
    }
  }
</style>
