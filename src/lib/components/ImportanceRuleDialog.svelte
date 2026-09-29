<script lang="ts">
  import { enhance } from '$app/forms';
  import Icon from './Icon.svelte';
  import { importanceLevels, type Importance } from '$lib/categories';
  import {
    importanceLabels,
    importanceRuleKindLabels,
    importanceRuleKinds,
    suggestImportanceRulePattern,
    type ImportanceRuleKind,
  } from '$lib/importance-rules';
  import { showToast } from '$lib/toast.svelte';

  let {
    email,
    onClose,
  }: {
    email: { id: number; fromAddress: string; subject: string; importance: Importance | null };
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  // The dialog shows one message, so it reads the message props only when it opens.
  function initialValues() {
    const kind: ImportanceRuleKind = suggestImportanceRulePattern('sender', email)
      ? 'sender'
      : 'subject';
    return {
      kind,
      pattern: suggestImportanceRulePattern(kind, email),
      importance: email.importance ?? 'important',
    };
  }
  const initial = initialValues();
  let kind = $state<ImportanceRuleKind>(initial.kind);
  let pattern = $state(initial.pattern);
  let importance = $state<Importance>(initial.importance);
  let error = $state('');

  function changeKind(next: ImportanceRuleKind) {
    kind = next;
    pattern = suggestImportanceRulePattern(next, email);
  }
</script>

<!-- A click on the dialog element itself is a click on its backdrop. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  {@attach (element: HTMLDialogElement) => element.showModal()}
  class="rule-dialog"
  aria-labelledby="importance-rule-heading"
  onclose={onClose}
  onclick={(event) => {
    if (event.target === event.currentTarget) dialog?.close();
  }}
>
  <div class="rule-heading">
    <h2 id="importance-rule-heading">Add importance rule</h2>
    <button type="button" class="close" aria-label="Close" onclick={() => dialog?.close()}
      ><Icon name="close" size="1.25rem" /></button
    >
  </div>
  <p class="help">
    A rule sets the importance of new messages in this account. It replaces the Jev answer.
  </p>
  <form
    method="POST"
    action="?/saveImportanceRule"
    use:enhance={() =>
      async ({ result }) => {
        if (result.type === 'success') {
          if (typeof result.data?.message === 'string') showToast(result.data.message);
          dialog?.close();
        } else if (result.type === 'failure') {
          error = String(result.data?.error ?? 'Could not save the importance rule.');
        } else {
          error = 'Could not save the importance rule.';
        }
      }}
  >
    <input type="hidden" name="id" value={email.id} />
    <label for="importance-rule-kind">Type</label>
    <select
      id="importance-rule-kind"
      name="kind"
      value={kind}
      onchange={(event) => changeKind(event.currentTarget.value as ImportanceRuleKind)}
    >
      {#each importanceRuleKinds as value (value)}
        <option {value}>{importanceRuleKindLabels[value]}</option>
      {/each}
    </select>
    <label for="importance-rule-pattern">Value</label>
    <input
      id="importance-rule-pattern"
      name="pattern"
      bind:value={pattern}
      required
      autocomplete="off"
      spellcheck="false"
    />
    {#if kind === 'subject'}<p class="help">A regular expression. Case is not important.</p>{/if}
    <label for="importance-rule-importance">Importance</label>
    <select id="importance-rule-importance" name="importance" bind:value={importance}>
      {#each importanceLevels as value (value)}
        <option {value}>{importanceLabels[value]}</option>
      {/each}
    </select>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="secondary" onclick={() => dialog?.close()}>Cancel</button>
      <button type="submit" class="primary">Save rule</button>
    </div>
  </form>
</dialog>

<style>
  .rule-dialog {
    width: min(420px, calc(100% - 32px));
    padding: 20px;
    color: inherit;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    box-shadow: 0 20px 60px var(--color-shadow);
  }
  .rule-dialog::backdrop {
    background: var(--color-backdrop);
  }
  .rule-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  button {
    cursor: pointer;
    color: inherit;
  }
  .close {
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
  }
  .help {
    margin: 6px 0 0;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    line-height: 1.5;
  }
  label {
    display: block;
    margin: 14px 0 6px;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  input,
  select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
  }
  .error {
    margin: 12px 0 0;
    color: var(--color-danger);
    font-size: var(--text-sm);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  .actions button {
    padding: 8px 14px;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: 650;
  }
  .secondary {
    border: 1px solid var(--color-border-strong);
    background: transparent;
  }
  .primary {
    border: 0;
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
</style>
