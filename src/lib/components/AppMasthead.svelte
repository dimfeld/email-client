<script lang="ts" module>
  export const appLinks = [
    { href: '/', label: 'Mail' },
    { href: '/notes', label: 'Notes' },
    { href: '/todos', label: 'To-dos' },
    { href: '/contacts', label: 'Contacts' },
    { href: '/calendar', label: 'Calendar' },
    { href: '/settings', label: 'Settings' },
  ] as const;
</script>

<script lang="ts">
  let { active }: { active: (typeof appLinks)[number]['href'] } = $props();
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
</header>

<style>
  .masthead {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--color-border);
  }
  .brand {
    display: flex;
    gap: 10px;
    color: var(--color-text);
    text-decoration: none;
  }
  .brand span {
    color: var(--color-accent);
    font-size: 1.4rem;
  }
  nav {
    margin-left: auto;
    display: flex;
    gap: 18px;
  }
  nav a {
    color: var(--color-text-muted);
    white-space: nowrap;
    text-decoration: none;
    font-size: 0.85rem;
  }
  nav a.active {
    color: var(--color-accent);
  }
  @media (max-width: 760px) {
    .masthead {
      flex-wrap: wrap;
    }
    nav {
      width: 100%;
      margin: 0;
      overflow-x: auto;
    }
  }
</style>
