<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { commandError, localDue } from '$lib/pim';
  import { createTodoCommand, getEmailTodoTitles } from '$lib/pim.remote';
  import { onStateChange } from '$lib/state-change';
  import { showToast } from '$lib/toast.svelte';

  let {
    emailId,
    title,
    details,
    due,
  }: {
    emailId: number;
    title: string;
    details: string | null;
    /** An extracted date or ISO time. The to-do becomes a reminder when it is set. */
    due: string | null;
  } = $props();

  let added = $derived((await getEmailTodoTitles(emailId)).includes(title));
  let busy = $state(false);

  async function add() {
    busy = true;
    try {
      const todo = await createTodoCommand({
        title,
        description: details ?? '',
        ...localDue(due),
        sourceEmailId: emailId,
      });
      await getEmailTodoTitles(emailId).refresh();
      showToast(todo.dueDate ? 'Reminder added to your to-dos.' : 'To-do added.', {
        action: { label: 'Open', run: () => void goto(`/todos?todo=${todo.id}`) },
      });
    } catch (error) {
      showToast(commandError(error), { tone: 'error' });
    } finally {
      busy = false;
    }
  }

  onMount(() =>
    onStateChange(async (scopes) => {
      if (scopes.has('pim')) await getEmailTodoTitles(emailId).refresh();
    })
  );
</script>

<button type="button" disabled={added || busy} onclick={add}
  >{added ? 'Added to to-dos' : due ? 'Add reminder' : 'Add to-do'}</button
>

<style>
  button {
    justify-self: start;
    margin-top: 4px;
    padding: 4px 8px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface-raised);
    color: var(--color-accent-text);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  button:disabled {
    color: var(--color-text-muted);
    cursor: default;
  }
</style>
