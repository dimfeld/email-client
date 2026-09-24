<script lang="ts">
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  let { children, data }: { children: Snippet; data: LayoutData } = $props();

  const sections = [
    { href: '/settings/remote-images', label: 'Remote images' },
    { href: '/settings/calendars', label: 'Mail sidebar calendars' },
    { href: '/settings/import', label: 'Historical import' },
    { href: '/settings/categories', label: 'Categories' },
  ];
  let accountLinks = $derived(
    data.settingsAccounts.map((account) => ({
      href: `/settings/accounts/${encodeURIComponent(account.email)}`,
      label: account.alias ?? account.email,
    }))
  );
  let active = $derived(
    [{ href: '/settings/accounts', label: 'Accounts' }, ...accountLinks, ...sections].find(
      (section) => section.href === page.url.pathname
    )
  );
  let form = $derived(page.form as { error?: string; message?: string } | null);
</script>

<svelte:head><title>{active ? `${active.label} — ` : ''}Settings — Email Check</title></svelte:head>

<main>
  <header>
    <nav class="apps">
      <a href="/">Mail</a><a href="/contacts">Contacts</a><a href="/calendar">Calendar</a>
    </nav>
    <h1>Settings</h1>
  </header>
  <div class="settings-body">
    <nav class="sections" aria-label="Settings">
      <a
        href="/settings/accounts"
        aria-current={active?.href === '/settings/accounts' ? 'page' : undefined}
        data-sveltekit-noscroll>Accounts</a
      >
      {#each accountLinks as account (account.href)}
        <a
          class="sub"
          href={account.href}
          title={account.label}
          aria-current={active?.href === account.href ? 'page' : undefined}
          data-sveltekit-noscroll>{account.label}</a
        >
      {/each}
      {#each sections as section (section.href)}
        <a
          href={section.href}
          aria-current={active?.href === section.href ? 'page' : undefined}
          data-sveltekit-noscroll>{section.label}</a
        >
      {/each}
    </nav>
    <div class="settings-content">
      {#if form?.error}<p class="feedback error" role="alert">{form.error}</p>{/if}
      {#if form?.message}<p class="feedback" role="status">{form.message}</p>{/if}
      {@render children()}
    </div>
  </div>
</main>

<style>
  main {
    max-width: 1100px;
    margin: auto;
    padding: 32px 24px 64px;
  }
  header {
    padding-bottom: 20px;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 28px;
  }
  .apps {
    display: flex;
    gap: 18px;
  }
  .apps a {
    color: var(--color-accent);
    text-decoration: none;
    font-size: 0.9rem;
  }
  h1 {
    margin: 24px 0 0;
    font-size: 2rem;
  }
  .settings-body {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 40px;
    align-items: start;
  }
  .sections {
    position: sticky;
    top: 24px;
    display: grid;
    gap: 2px;
  }
  .sections a {
    padding: 9px 12px;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .sections a.sub {
    padding-left: 24px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sections a:hover {
    background: var(--color-surface-raised);
  }
  .sections a[aria-current='page'] {
    background: var(--color-accent-bg);
    color: var(--color-accent-text);
    font-weight: 650;
  }
  .settings-content {
    max-width: 760px;
  }
  .feedback {
    margin: 0 0 20px;
    padding: 14px 16px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    color: var(--color-accent-text);
    line-height: 1.6;
  }
  .error {
    color: var(--color-danger);
  }
  :focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 3px;
  }
  /* The subpages share these form and card styles. They have zero specificity, so the
     styles of a component such as HistoricalBackfillPanel apply first. */
  :where(.settings-content) :global {
    h2 {
      margin: 0 0 12px;
      font-size: 1.3rem;
    }
    h3 {
      margin: 0;
      font-size: 1.05rem;
      overflow-wrap: anywhere;
    }
    p {
      color: var(--color-text-muted);
      line-height: 1.6;
      margin: 0;
    }
    .help {
      margin-bottom: 12px;
      font-size: 0.9rem;
    }
    section + section {
      margin-top: 36px;
    }
    .sync-list {
      display: grid;
      gap: 10px;
      margin-top: 18px;
    }
    .sync-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 16px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .sync-card p {
      margin-top: 6px;
      color: var(--color-text-muted);
      font-size: 0.75rem;
      line-height: 1.6;
    }
    label {
      display: block;
      font-size: 0.85rem;
      margin: 16px 0 8px;
      color: var(--color-text-secondary);
    }
    input:where(:not([type='hidden'], [type='checkbox'])),
    textarea,
    select {
      width: 100%;
      padding: 10px 12px;
      background: var(--color-bg);
      color: var(--color-text);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-sm);
      font: inherit;
    }
    textarea {
      resize: vertical;
      line-height: 1.5;
    }
  }
  /* The global button rule in app.css has zero specificity too, so buttons need a class. */
  .settings-content :global {
    button {
      cursor: pointer;
      border: 1px solid var(--color-accent);
      background: var(--color-accent);
      color: var(--color-bg);
      padding: 10px 16px;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      font-weight: 600;
    }
    a.button-link {
      display: inline-block;
      color: var(--color-bg);
      background: var(--color-accent);
      padding: 10px 16px;
      border-radius: var(--radius-sm);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 600;
    }
    button.remove {
      border-color: var(--color-border-strong);
      background: transparent;
      color: var(--color-danger);
    }
  }
  @media (max-width: 760px) {
    main {
      padding: 24px 16px;
    }
    .settings-body {
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
    }
    .sections {
      position: static;
      display: flex;
      overflow-x: auto;
    }
    .sections a {
      flex-shrink: 0;
    }
    .settings-content :global(.sync-card) {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
