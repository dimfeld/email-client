<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Category } from '$lib/categories';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let drafts = $state.raw<Record<string, Category>>({});
  let rows = $derived(
    [...data.categories, { id: '', name: '', description: '', level: 'auto' as const }].map(
      (category) =>
        drafts[category.id] ?? (form?.values?.id === category.id ? form.values : category)
    )
  );

  const submitCategory: SubmitFunction =
    ({ formData }) =>
    async ({ result, update }) => {
      await update({ reset: false });
      if (result.type === 'success') {
        const id = String(formData.get('id') ?? '');
        const { [id]: saved, ...remaining } = drafts;
        drafts = remaining;
      }
    };

  function preserveDraft(category: Category) {
    if (!drafts[category.id]) drafts = { ...drafts, [category.id]: category };
  }
</script>

<section aria-labelledby="categories-heading">
  <h2 id="categories-heading">Categories</h2>
  <p class="help">
    Jev uses each category name and description when it classifies a message. Changes apply to
    future classifications. Existing messages keep their category.
  </p>
  <p class="help">
    <strong>All important</strong> shows Important messages. <strong>Useful now</strong> shows Important
    and Useful messages. A fixed level applies to messages classified after you set it.
  </p>
  <p class="help">
    With Auto, Jev chooses Important, Useful, or Other for each message. Existing messages without a
    result need another sync.
  </p>

  {#each rows as category (category)}
    <form
      method="POST"
      action="?/save"
      use:enhance={submitCategory}
      oninput={() => preserveDraft(category)}
      class="category-card"
      aria-label={category.id ? `Edit ${category.name}` : 'Add category'}
    >
      <input type="hidden" name="id" value={category.id} />
      <div class="card-heading">
        <h3>{category.id ? category.name : 'Add category'}</h3>
        <span class="badge"
          >{category.level === 'important'
            ? 'Important'
            : category.level === 'useful'
              ? 'Useful'
              : category.level === 'auto'
                ? 'Auto'
                : 'Other'}</span
        >
      </div>
      <label for={`name-${category.id}`}>Name</label>
      <input id={`name-${category.id}`} name="name" value={category.name} required />
      <label for={`description-${category.id}`}>Description</label>
      <textarea id={`description-${category.id}`} name="description" required rows="3"
        >{category.description}</textarea
      >
      <label for={`level-${category.id}`}>Level</label>
      <select id={`level-${category.id}`} name="level">
        <option value="important" selected={category.level === 'important'}>Important</option>
        <option value="useful" selected={category.level === 'useful'}>Useful</option>
        <option value="other" selected={category.level === 'other'}>Other</option>
        <option value="auto" selected={category.level === 'auto'}>Auto — let Jev decide</option>
      </select>
      <div class="actions">
        <button type="submit">{category.id ? 'Save category' : 'Add category'}</button>
        {#if category.id}<button type="submit" class="remove" formaction="?/remove" formnovalidate
            >Remove category</button
          >{/if}
      </div>
      {#if category.id}<p class="remove-help">
          If you remove this category, its messages will move to Needs classification.
        </p>{/if}
    </form>
  {/each}
</section>

<style>
  .category-card {
    padding: 24px;
    margin-top: 20px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }
  .card-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .badge {
    background: var(--color-warning-bg);
    color: var(--color-warning);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
  }
  .actions {
    margin-top: 20px;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .remove-help {
    margin-top: 14px;
    font-size: 0.75rem;
  }
  @media (max-width: 760px) {
    .category-card {
      padding: 18px;
    }
  }
</style>
