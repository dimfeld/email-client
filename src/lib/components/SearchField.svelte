<script lang="ts">
  import {
    searchSuggestions,
    type SearchSuggestion,
    type SearchSuggestionSource,
  } from '$lib/search-suggestions';

  let {
    input = $bindable(null),
    value,
    loadSource,
    onkeydown,
  }: {
    input: HTMLInputElement | null;
    value: string;
    /** Returns the current contacts and domains. */
    loadSource: () => Promise<SearchSuggestionSource>;
    /** Receives the keys that the suggestion list does not use. */
    onkeydown: (event: KeyboardEvent) => void;
  } = $props();

  const listId = 'search-suggestions';
  let text = $derived(value);
  let source = $state<SearchSuggestionSource | null>(null);
  let focused = $state(false);
  let dismissed = $state(false);
  let active = $state(-1);
  let suggestions = $derived(source ? searchSuggestions(text, source) : []);
  let open = $derived(focused && !dismissed && suggestions.length > 0);

  function choose(suggestion: SearchSuggestion) {
    text = suggestion.query;
    active = -1;
    input?.focus();
  }

  function keydown(event: KeyboardEvent) {
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + suggestions.length + 1) % (suggestions.length + 1);
      if (active === suggestions.length) active = -1;
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (open && event.key === 'Enter' && suggestions[active]) {
      event.preventDefault();
      choose(suggestions[active]);
    } else if (open && event.key === 'Escape') {
      event.preventDefault();
      dismissed = true;
    } else {
      onkeydown(event);
      // The page handler can clear the field directly.
      if (input) text = input.value;
    }
  }
</script>

<div class="search-field">
  <input
    bind:this={input}
    bind:value={text}
    name="q"
    role="combobox"
    aria-label="Search email"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={listId}
    aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
    autocomplete="off"
    placeholder={'Search email · in:inbox · from:example.com'}
    oninput={() => {
      dismissed = false;
      active = -1;
    }}
    onfocus={() => {
      focused = true;
      // Each focus loads the list again, so it includes domains from new mail.
      void loadSource().then((loaded) => (source = loaded));
    }}
    onblur={() => (focused = false)}
    onkeydown={keydown}
  />
  {#if open}<div class="suggestions" id={listId} role="listbox" aria-label="Search suggestions">
      {#each suggestions as suggestion, index (suggestion.query)}<button
          type="button"
          role="option"
          id={`${listId}-${index}`}
          tabindex="-1"
          aria-selected={index === active}
          class:active={index === active}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => choose(suggestion)}
          ><strong>{suggestion.label}</strong><span>{suggestion.detail}</span></button
        >{/each}
    </div>{/if}
</div>

<style>
  .search-field {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  input {
    width: 100%;
    min-width: 0;
    padding: 8px 10px;
    background: transparent;
    border: 0;
    color: var(--color-text);
    font: inherit;
    font-size: 0.75rem;
  }
  .suggestions {
    position: absolute;
    z-index: 5;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    max-height: 280px;
    overflow-y: auto;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 20px var(--color-shadow);
  }
  button {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    color: var(--color-text);
    background: none;
    border: 0;
    cursor: pointer;
  }
  button:hover,
  button.active {
    background: var(--color-accent-bg);
  }
  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  strong {
    font-size: 0.8rem;
    font-weight: 500;
  }
  span {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
</style>
