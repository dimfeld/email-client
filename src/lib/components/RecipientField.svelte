<script lang="ts">
  let {
    label,
    value = $bindable(''),
    contacts,
    onchange,
  }: {
    label: string;
    value: string;
    contacts: { name: string; emails: string[] }[];
    onchange: () => void;
  } = $props();
  let focused = $state(false);
  let input: HTMLInputElement;
  let term = $derived(
    value
      .slice(value.lastIndexOf(',') + 1)
      .trim()
      .toLowerCase()
  );
  let suggestions = $derived(
    term
      ? contacts
          .flatMap((contact) => contact.emails.map((email) => ({ email, name: contact.name })))
          .filter(
            (item, index, all) =>
              (item.email.toLowerCase().includes(term) || item.name.toLowerCase().includes(term)) &&
              all.findIndex((other) => other.email === item.email) === index
          )
      : []
  );
  function choose(item: { name: string; email: string }) {
    const recipient = item.name ? `"${item.name.replaceAll('"', '')}" <${item.email}>` : item.email;
    value = `${value.slice(0, value.lastIndexOf(',') + 1)}${value.includes(',') ? ' ' : ''}${recipient}, `;
    onchange();
    input.focus();
  }
</script>

<div
  class="recipient"
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) focused = false;
  }}
>
  <label for={`compose-${label}`}>{label}</label>
  <input
    bind:this={input}
    id={`compose-${label}`}
    bind:value
    oninput={onchange}
    onfocus={() => (focused = true)}
    autocomplete="off"
    placeholder="Name or email address"
    onkeydown={(event) => {
      if (event.key === 'Enter' && suggestions[0]) {
        event.preventDefault();
        choose(suggestions[0]);
      }
    }}
  />
  {#if focused && suggestions.length}<div
      class="suggestions"
      aria-label={`${label} contact suggestions`}
    >
      {#each suggestions as item}<button type="button" onclick={() => choose(item)}
          ><strong>{item.name || item.email}</strong><span>{item.email}</span></button
        >{/each}
    </div>{/if}
</div>

<style>
  .recipient {
    display: flex;
    position: relative;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--color-border-strong);
  }
  label {
    width: 42px;
    font-size: 0.78rem;
    color: var(--color-text-muted);
    flex: none;
  }
  input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: 0.82rem;
  }
  .suggestions {
    position: absolute;
    z-index: 3;
    top: 100%;
    left: 60px;
    right: 12px;
    max-height: 220px;
    overflow-y: auto;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-hover);
    box-shadow: 0 8px 20px var(--color-shadow);
  }
  button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 9px 12px;
    color: var(--color-text);
    background: none;
    border: 0;
    cursor: pointer;
  }
  button:hover,
  button:focus {
    background: var(--color-accent-bg);
  }
  strong {
    font-size: 0.8rem;
  }
  span {
    display: block;
    margin-top: 2px;
    font-size: 0.7rem;
    color: var(--color-text-secondary);
  }
</style>
