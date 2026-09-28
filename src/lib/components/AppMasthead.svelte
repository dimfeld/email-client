<script lang="ts" module>
  import { goto } from '$app/navigation';

  export const appLinks = [
    { href: '/', label: 'Mail' },
    { href: '/notes', label: 'Notes' },
    { href: '/todos', label: 'To-dos' },
    { href: '/contacts', label: 'Contacts' },
    { href: '/calendar', label: 'Calendar' },
    { href: '/settings', label: 'Settings' },
  ] as const;

  /** Ctrl + 1–6 opens the app page at that position in `appLinks`. Returns true if it navigated. */
  export function handleAppLinkShortcut(event: KeyboardEvent) {
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const link = /^[1-9]$/.test(event.key) ? appLinks[Number(event.key) - 1] : undefined;
    if (!link) return false;
    event.preventDefault();
    void goto(link.href);
    return true;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getChatContext } from '$lib/chat-context';

  // `children` holds the controls of the page, such as the mail search and Compose button.
  let { active, children }: { active: (typeof appLinks)[number]['href']; children?: Snippet } =
    $props();
  const chat = getChatContext();
</script>

<header class="masthead">
  <a class="brand" href="/"><span aria-hidden="true">@</span><strong>Email Check</strong></a>
  <nav aria-label="Application">
    {#each appLinks as link (link.href)}<a
        class:active={link.href === active}
        aria-current={link.href === active ? 'page' : undefined}
        href={link.href}>{link.label}</a
      >{/each}
  </nav>
  <div class="tools">
    {#if children}{@render children()}{/if}
    <button class="chat-button" aria-pressed={chat.open} onclick={() => (chat.open = !chat.open)}
      >Chat</button
    >
  </div>
</header>

<style>
  /* The brand and the links stay in the same place on each page. Page controls go to the right,
     and move to a second row when the row is too narrow. */
  .masthead {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
    min-height: 61px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--color-border);
  }
  .brand {
    display: flex;
    gap: 10px;
    color: var(--color-text);
    text-decoration: none;
    white-space: nowrap;
  }
  .brand span {
    color: var(--color-accent);
    font-size: 1.4rem;
  }
  nav {
    display: flex;
    gap: 18px;
  }
  nav a {
    color: var(--color-text-muted);
    white-space: nowrap;
    text-decoration: none;
    font-size: 0.85rem;
  }
  nav a:hover {
    color: var(--color-text);
  }
  nav a.active {
    color: var(--color-accent);
  }
  .tools {
    flex: 1 1 560px;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 10px 8px;
  }
  .chat-button {
    border: 0;
    border-radius: var(--radius-md);
    padding: 8px;
    background: none;
    color: var(--color-accent);
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: pointer;
  }
  .chat-button:hover,
  .chat-button[aria-pressed='true'] {
    background: var(--color-accent-bg-subtle);
  }
  @media (max-width: 760px) {
    /* The links are the full first row, so the brand does not use a row of its own. */
    .masthead {
      gap: 8px;
      min-height: 0;
      padding: 0 8px 8px;
    }
    .brand {
      display: none;
    }
    nav {
      width: calc(100% + 16px);
      margin-inline: -8px;
      padding: 12px 16px 4px;
      gap: 14px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    nav a {
      font-size: var(--text-sm);
    }
    .tools {
      flex-basis: 100%;
      justify-content: flex-start;
    }
  }
</style>
