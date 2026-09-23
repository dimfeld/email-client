<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { openComposer } from '$lib/composer';
  import { showToast } from '$lib/toast.svelte';
  import { MAIL_PAGE_SIZE } from '$lib/mail-list';
  import { onStateChange } from '$lib/state-change';
  import EmailChat from '$lib/components/EmailChat.svelte';
  import CalendarRail from '$lib/components/CalendarRail.svelte';
  import { deserialize, enhance } from '$app/forms';
  import { goto, onNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { effectiveImportance } from '$lib/categories';
  import { dateKeyFromDate, isDateKey } from '$lib/calendar';
  import { buildEmailDocument, hasRemoteImages } from '$lib/email-html';
  import { allowsRemoteImages, senderAddress, senderDomain } from '$lib/remote-images';
  import {
    getMailAccounts,
    getMailCalendars,
    getMailCategories,
    getMailEvents,
    getMailList,
    getRemoteImageRules,
    getSelectedMessage,
  } from './mail.remote';
  import type { ActionData } from './$types';
  import type { EmailSummary, StoredEmail } from '$lib/server/types';

  let { form }: { form: ActionData } = $props();
  let currentUrl = $derived(page.url.href);
  let requestedAccount = $derived(new URL(currentUrl).searchParams.get('account'));
  let accounts = $derived(await getMailAccounts());
  let selectedAccount = $derived(
    accounts.some((account) => account.email === requestedAccount) ? requestedAccount : null
  );
  let search = $derived(new URL(currentUrl).searchParams.get('q')?.trim() ?? '');
  let requestedDay = $derived(new URL(currentUrl).searchParams.get('day'));
  let calendarDay = $derived(isDateKey(requestedDay) ? requestedDay : dateKeyFromDate(new Date()));
  let selectedId = $derived.by(() => {
    const requested = new URL(currentUrl).searchParams.get('message');
    const id = requested ? Number(requested) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  let categories = $derived(await getMailCategories());
  let remoteImageRules = $derived(await getRemoteImageRules());
  let calendars = $derived(await getMailCalendars());
  let calendarEvents = $derived(
    await getMailEvents({ account: selectedAccount, day: calendarDay })
  );
  // The URL filter is valid when it is a fixed filter or a category that exists.
  let activeFilter = $derived.by(() => {
    const requested = new URL(currentUrl).searchParams.get('category') ?? 'all';
    const fixed = ['all', 'important', 'useful', 'pending'];
    return fixed.includes(requested) || categories.some((category) => category.id === requested)
      ? requested
      : 'all';
  });
  // Pages of the list that are loaded. A new list starts again at one page.
  let pageCount = $derived.by(() => {
    void [selectedAccount, search, activeFilter];
    return 1;
  });
  let mailList = $derived(
    await getMailList({
      account: selectedAccount,
      search,
      filter: activeFilter,
      limit: pageCount * MAIL_PAGE_SIZE,
    })
  );
  let selectedMessage = $derived(
    selectedId === null
      ? null
      : await getSelectedMessage({ account: selectedAccount, id: selectedId })
  );
  let data = $derived({
    accounts,
    categories,
    calendars,
    calendarEvents,
    calendarDay,
    selectedAccount,
    query: search,
    ...mailList,
  });

  // Messages archived or deleted here leave the list at once, before Gmail confirms.
  const removedIds = new SvelteSet<number>();
  let emails = $derived.by(() => {
    const removed = new Set(removedIds);
    return data.emails.filter((email) => !removed.has(email.id));
  });

  type Filter = string;
  let labels = $derived(
    Object.fromEntries(data.categories.map((category) => [category.id, category.name]))
  );
  let categoryLevels = $derived(
    new Map(data.categories.map((category) => [category.id, category.level]))
  );
  // Read derived values into locals before a loop. A derived read inside a per-email callback
  // can check or recompute its whole dependency chain on every call, which froze the inbox.
  let importanceById = $derived.by(() => {
    const levels = categoryLevels;
    return new Map(
      emails.map((email) => [
        email.id,
        effectiveImportance(levels.get(email.category ?? ''), email.importance),
      ])
    );
  });
  function importance(email: EmailSummary | StoredEmail) {
    return (
      importanceById.get(email.id) ??
      effectiveImportance(categoryLevels.get(email.category ?? ''), email.importance)
    );
  }
  function mailListArgs() {
    return {
      account: selectedAccount,
      search,
      filter: activeFilter,
      limit: pageCount * MAIL_PAGE_SIZE,
    };
  }

  // The server filters the list and counts each filter over the whole mailbox.
  let filterCounts = $derived(data.counts);
  let mobileDetail = $derived(new URL(currentUrl).searchParams.has('message'));
  let showChat = $state(false);
  let showCategories = $state(false);
  let showShortcuts = $state(false);
  let shortcutDialog = $state<HTMLDialogElement | null>(null);
  let archiveForm = $state<HTMLFormElement | null>(null);
  let deleteForm = $state<HTMLFormElement | null>(null);
  let readingContent = $state<HTMLElement | null>(null);
  let messageList = $state<HTMLElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let remoteImagesFor = $state<number | null>(null);
  let filters = $derived([
    { category: 'all' as const, label: 'All mail', count: filterCounts.all ?? 0 },
    { category: 'important', label: 'All important', count: filterCounts.important ?? 0 },
    { category: 'useful' as const, label: 'Useful now', count: filterCounts.useful ?? 0 },
    ...data.categories.map((category) => ({
      category: category.id,
      label: category.name,
      count: filterCounts[category.id] ?? 0,
    })),
    { category: 'pending', label: 'Needs classification', count: filterCounts.pending ?? 0 },
  ]);
  let visibleEmails = $derived(emails);
  // The whole list size, for screen readers, since only some rows are in the page.
  let listSize = $derived(
    filters.find((filter) => filter.category === activeFilter)?.count ?? visibleEmails.length
  );
  let selectedEmail = $derived(selectedId === null ? null : selectedMessage);
  let remoteImagesAllowed = $derived(
    selectedEmail !== null &&
      (remoteImagesFor === selectedEmail.id ||
        allowsRemoteImages(selectedEmail.fromAddress, remoteImageRules))
  );
  let clearSearchHref = $derived(
    data.selectedAccount ? `/?account=${encodeURIComponent(data.selectedAccount)}` : '/'
  );
  let filterLabel = $derived(
    filters.find((filter) => filter.category === activeFilter)?.label ?? 'All mail'
  );

  function mailboxHref(changes: { category?: Filter; message?: number | null }): string {
    const url = new URL(currentUrl);
    if (changes.category !== undefined) {
      if (changes.category === 'all') url.searchParams.delete('category');
      else url.searchParams.set('category', changes.category);
    }
    if (changes.message !== undefined) {
      if (changes.message === null) url.searchParams.delete('message');
      else url.searchParams.set('message', String(changes.message));
    }
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function updateMailboxUrl(changes: { category?: Filter; message?: number | null }) {
    const href = mailboxHref(changes);
    if (new URL(href, currentUrl).href !== currentUrl)
      void goto(href, { keepFocus: true, noScroll: true });
  }

  function selectFilter(filter: Filter) {
    updateMailboxUrl({ category: filter, message: null });
  }

  function fitMessageFrame(frame: HTMLIFrameElement, reset: boolean) {
    try {
      // A reset lets the frame shrink. Later fits only follow content growth, such as images.
      if (reset) frame.style.height = '0px';
      const document = frame.contentDocument;
      if (document) frame.style.height = `${document.documentElement.scrollHeight}px`;
    } catch {
      frame.style.removeProperty('height');
    }
  }

  function senderName(from: string): string {
    return from.replace(/\s*<[^>]+>\s*$/, '').replace(/^"|"$/g, '') || from || 'Unknown sender';
  }

  function formatDate(value: string | null): string {
    if (!value) return 'Date unknown';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return value;
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
        date
      );
    }
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }).format(date);
  }

  function formatFullDate(value: string | null): string {
    if (!value) return 'Date unknown';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return value;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(
      date
    );
  }

  function confidence(email: StoredEmail): string | null {
    if (email.categoryConfidence === null) return null;
    return `${Math.round(email.categoryConfidence * 100)}%`;
  }

  function probability(value: number | null): string | null {
    if (value === null) return null;
    return `${Math.round(value * 100)}%`;
  }

  function jevAnswer(value: boolean | null, probabilityValue: number | null): string | null {
    if (value === null || probabilityValue === null) return null;
    return `${value ? 'Yes' : 'No'} (${probability(probabilityValue)})`;
  }

  function extractedDate(value: string | null): string | null {
    if (!value) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
    if (Number.isNaN(date.valueOf())) return value;
    return new Intl.DateTimeFormat(
      undefined,
      dateOnly
        ? { dateStyle: 'medium', timeZone: 'UTC' }
        : { dateStyle: 'medium', timeStyle: 'short' }
    ).format(date);
  }

  function moveSelection(offset: number) {
    if (visibleEmails.length === 0) return;
    const currentIndex = selectedEmail
      ? visibleEmails.findIndex((email) => email.id === selectedEmail.id)
      : -1;
    const nextIndex =
      currentIndex < 0
        ? offset > 0
          ? 0
          : visibleEmails.length - 1
        : Math.max(0, Math.min(visibleEmails.length - 1, currentIndex + offset));
    if (nextIndex === currentIndex && offset > 0 && data.hasMore) pageCount += 1;
    updateMailboxUrl({ message: visibleEmails[nextIndex].id });
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object' || !('tagName' in target)) return false;
    const element = target as HTMLElement;
    return (
      element.isContentEditable ||
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) ||
      !!element.closest('a[href]:not(.message)')
    );
  }

  function handleMessageLinkClick(event: MouseEvent) {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const anchor = (event.target as Element | null)?.closest?.(
      'a[href]'
    ) as HTMLAnchorElement | null;
    if (!anchor) return;
    event.preventDefault();
    const url = new URL(anchor.href);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
      window.open(url.href, '_blank', 'noopener,noreferrer');
    }
  }

  function messageFrame(frame: HTMLIFrameElement) {
    let observer: ResizeObserver | undefined;
    function load() {
      observer?.disconnect();
      fitMessageFrame(frame, true);
      frame.dataset.loaded = '';
      const document = frame.contentDocument;
      if (!document) return;
      observer = new ResizeObserver(() => fitMessageFrame(frame, false));
      observer.observe(document.body ?? document.documentElement);
      document.addEventListener('keydown', handleKeydown);
      document.addEventListener('click', handleMessageLinkClick);
      document.addEventListener('auxclick', handleMessageLinkClick);
    }
    frame.addEventListener('load', load);
    return () => {
      frame.removeEventListener('load', load);
      observer?.disconnect();
    };
  }

  async function handleKeydown(event: KeyboardEvent) {
    if (
      isInteractiveTarget(event.target) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.repeat
    )
      return;
    if (showShortcuts && event.key !== 'Escape' && event.key !== '?') return;
    const key = event.key.toLowerCase();
    if (key === 'c') {
      event.preventDefault();
      openComposer({ mode: 'new', account: data.selectedAccount ?? undefined });
    } else if (key === 'r' && selectedEmail) {
      event.preventDefault();
      openComposer({ mode: 'reply', sourceEmailId: selectedEmail.id });
    } else if (key === 'a' && selectedEmail) {
      event.preventDefault();
      openComposer({ mode: 'replyAll', sourceEmailId: selectedEmail.id });
    } else if (key === 'f' && selectedEmail) {
      event.preventDefault();
      openComposer({ mode: 'forward', sourceEmailId: selectedEmail.id });
    } else if (key === 'j') {
      event.preventDefault();
      moveSelection(1);
    } else if (key === 'k') {
      event.preventDefault();
      moveSelection(-1);
    } else if (key === 'e' && selectedEmail && archiveForm) {
      event.preventDefault();
      archiveForm.requestSubmit();
    } else if (
      (event.key === '#' || (event.shiftKey && event.code === 'Digit3')) &&
      selectedEmail &&
      deleteForm
    ) {
      event.preventDefault();
      deleteForm.requestSubmit();
    } else if (key === 'o' || event.key === 'Enter') {
      // Enter on a focused message row follows that row's link.
      if (event.key === 'Enter' && (event.target as Element | null)?.closest?.('.message')) return;
      if (selectedEmail || visibleEmails[0]) {
        event.preventDefault();
        updateMailboxUrl({ message: (selectedEmail ?? visibleEmails[0]).id });
        await tick();
        readingContent?.focus({ preventScroll: true });
      }
    } else if (key === 'u' || event.key === 'Escape') {
      event.preventDefault();
      if (showShortcuts) showShortcuts = false;
      else updateMailboxUrl({ message: null });
    } else if (event.key === '/') {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (event.key === '?') {
      event.preventDefault();
      showShortcuts = !showShortcuts;
    }
  }

  // On phones (the 760px layout breakpoint below) the list and the message are separate
  // views. Slide between them, unless the viewer asks for reduced motion or the browser has
  // no view transitions.
  onNavigate((navigation) => {
    const opens = navigation.to?.url.searchParams.has('message') ?? false;
    const closes = navigation.from?.url.searchParams.has('message') ?? false;
    if (
      opens === closes ||
      !document.startViewTransition ||
      !matchMedia('(max-width: 760px)').matches ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    document.documentElement.dataset.navDirection = opens ? 'forward' : 'back';
    return new Promise<void>((resolve) => {
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
      void transition.finished.finally(() => delete document.documentElement.dataset.navDirection);
    });
  });

  // Set before a navigation that should move focus into the new message.
  let focusReadingPaneOnLoad = false;
  $effect(() => {
    if (!readingContent || !focusReadingPaneOnLoad) return;
    focusReadingPaneOnLoad = false;
    readingContent.focus({ preventScroll: true });
  });

  function actionError(result: ActionResult): string {
    if (result.type === 'failure' && typeof result.data?.error === 'string')
      return result.data.error;
    if (result.type === 'error') return String(result.error?.message ?? result.error);
    return 'The action failed.';
  }

  async function postMessageAction(
    action: 'unarchive' | 'undelete' | 'markRead',
    id: number
  ): Promise<ActionResult> {
    const body = new FormData();
    body.set('id', String(id));
    const response = await fetch(`?/${action}`, {
      method: 'POST',
      body,
      headers: { 'x-sveltekit-action': 'true' },
    });
    return deserialize(await response.text());
  }

  // Opened messages are marked read at once, here and in Gmail. This runs from the rendered
  // message, because an effect can run before the async message query resolves.
  const readIds = new SvelteSet<number>();
  function markReadOnOpen(email: StoredEmail) {
    return () => {
      if (!email.labels.includes('UNREAD') || untrack(() => readIds.has(email.id))) return;
      readIds.add(email.id);
      void postMessageAction('markRead', email.id).then((result) => {
        if (result.type === 'success') return;
        readIds.delete(email.id);
        showToast(actionError(result), { tone: 'error' });
      });
    };
  }

  async function undoMessageAction(id: number, action: 'archive' | 'delete') {
    const result = await postMessageAction(action === 'archive' ? 'unarchive' : 'undelete', id);
    if (result.type !== 'success') {
      showToast(actionError(result), { tone: 'error' });
      return;
    }
    await getMailList(mailListArgs()).refresh();
    removedIds.delete(id);
    focusReadingPaneOnLoad = true;
    updateMailboxUrl({ message: id });
    if (typeof result.data?.message === 'string') showToast(result.data.message);
  }

  const submitMessageAction: SubmitFunction = ({ formData, cancel, action: url }) => {
    const id = Number(formData.get('id'));
    const action = url.search === '?/delete' ? 'delete' : 'archive';
    if (removedIds.has(id)) {
      cancel();
      return;
    }
    // Open the next message, as most mail clients do, so E can process mail row by row.
    const index = visibleEmails.findIndex((email) => email.id === id);
    const next = index < 0 ? null : (visibleEmails[index + 1] ?? visibleEmails[index - 1] ?? null);
    removedIds.add(id);
    focusReadingPaneOnLoad = next !== null;
    updateMailboxUrl({ message: next?.id ?? null });
    return async ({ result }) => {
      if (result.type === 'success') {
        // Gmail Trash and archive are recoverable, so Undo replaces a confirmation step.
        showToast(action === 'archive' ? 'Message archived.' : 'Message moved to Trash.', {
          action: { label: 'Undo', run: () => void undoMessageAction(id, action) },
        });
        await getMailList(mailListArgs()).refresh();
        return;
      }
      removedIds.delete(id);
      showToast(actionError(result), { tone: 'error' });
    };
  };

  const saveRemoteImageRule: SubmitFunction =
    ({ formData }) =>
    async ({ result, update }) => {
      await update({ invalidateAll: false });
      if (result.type === 'success') {
        if (typeof result.data?.message === 'string') showToast(result.data.message);
        await getRemoteImageRules().refresh();
        remoteImagesFor = Number(formData.get('id'));
      }
    };

  $effect(() => {
    if (!shortcutDialog) return;
    if (showShortcuts && !shortcutDialog.open) shortcutDialog.showModal();
    else if (!showShortcuts && shortcutDialog.open) shortcutDialog.close();
  });

  // Refresh only the queries for the kinds of data that changed on the server.
  $effect(() =>
    onStateChange((scopes) => {
      const account = selectedAccount;
      const tasks: Promise<void>[] = [];
      if (scopes.has('mail') || scopes.has('categories')) {
        tasks.push(getMailList(mailListArgs()).refresh());
        if (selectedId !== null)
          tasks.push(getSelectedMessage({ account, id: selectedId }).refresh());
      }
      if (scopes.has('categories')) tasks.push(getMailCategories().refresh());
      if (scopes.has('calendar')) {
        tasks.push(
          getMailCalendars().refresh(),
          getMailEvents({ account, day: calendarDay }).refresh()
        );
      }
      if (scopes.has('accounts')) tasks.push(getMailAccounts().refresh());
      return Promise.all(tasks);
    })
  );

  // The list renders only the rows near the viewport: the visible rows and one screen height
  // above and below. All rows have one height, so each position comes from the row index.
  let listScrollTop = $state(0);
  let listHeight = $state(0);
  let rowHeight = $state(40);
  let rowWindow = $derived.by(() => {
    const count = visibleEmails.length;
    // Before the list is measured (and on the server), render every loaded row.
    if (listHeight === 0) return { start: 0, end: count };
    return {
      start: Math.max(0, Math.floor((listScrollTop - listHeight) / rowHeight)),
      end: Math.min(count, Math.ceil((listScrollTop + 2 * listHeight) / rowHeight)),
    };
  });
  // Rows are taller on small screens, so measure a rendered row when the layout changes.
  $effect(() => {
    void [listHeight, visibleEmails.length];
    const row = untrack(() => messageList)?.querySelector<HTMLElement>('.message');
    if (row && row.offsetHeight > 0) rowHeight = row.offsetHeight;
  });
  // Load the next page when the rendered rows reach the end of the loaded rows.
  $effect(() => {
    if (data.hasMore && listHeight > 0 && rowWindow.end >= visibleEmails.length) {
      untrack(() => (pageCount += 1));
    }
  });

  // Keep the rows on screen in place when rows above them are added or removed, for example
  // when new mail arrives. Safari has no native scroll anchoring, so this is done here: each
  // scroll records the top visible row, and each list change scrolls that row back into place.
  let scrollAnchor: { id: number; offset: number } | null = null;
  function handleListScroll() {
    if (!messageList) return;
    listScrollTop = messageList.scrollTop;
    recordScrollAnchor();
  }
  function recordScrollAnchor() {
    const list = messageList;
    if (!list || list.scrollTop === 0) {
      scrollAnchor = null;
      return;
    }
    const index = Math.floor(list.scrollTop / rowHeight);
    const email = visibleEmails[index];
    scrollAnchor = email ? { id: email.id, offset: index * rowHeight - list.scrollTop } : null;
  }
  // A new filter, search, or account shows a different list, so it starts at the top.
  $effect.pre(() => {
    void [activeFilter, search, selectedAccount];
    scrollAnchor = null;
    listScrollTop = 0;
    untrack(() => messageList?.scrollTo({ top: 0 }));
  });
  $effect(() => {
    void visibleEmails;
    untrack(() => {
      const list = messageList;
      const anchor = scrollAnchor;
      if (!list || !anchor) return;
      const index = visibleEmails.findIndex((email) => email.id === anchor.id);
      if (index >= 0) list.scrollTop = index * rowHeight - anchor.offset;
      listScrollTop = list.scrollTop;
      recordScrollAnchor();
    });
  });

  // Keep the selected row visible when J and K move the selection.
  $effect(() => {
    const id = selectedId;
    const list = messageList;
    if (id === null || !list) return;
    untrack(() => {
      const index = visibleEmails.findIndex((email) => email.id === id);
      if (index < 0) return;
      const top = index * rowHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + rowHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = top + rowHeight - list.clientHeight;
      listScrollTop = list.scrollTop;
      // When a row has focus, focus follows the selection.
      if (document.activeElement?.closest('.message')) {
        void tick().then(() =>
          list.querySelector<HTMLElement>(`[data-email-id="${id}"]`)?.focus({ preventScroll: true })
        );
      }
    });
  });

  $effect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<svelte:head>
  <title>Email Check — {data.selectedAccount ?? 'All accounts'}</title>
</svelte:head>

<main>
  <header class="masthead">
    <div class="brand">
      <button
        class="menu-button"
        aria-label="Toggle mail categories"
        aria-expanded={showCategories}
        onclick={() => (showCategories = !showCategories)}><Icon name="menu" /></button
      >
      <h1>Inbox</h1>
    </div>
    <form method="GET" class="search-form">
      {#if data.selectedAccount}<input
          type="hidden"
          name="account"
          value={data.selectedAccount}
        />{/if}
      <input
        bind:this={searchInput}
        name="q"
        aria-label="Search email"
        onkeydown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          if (searchInput?.value) searchInput.value = '';
          else searchInput?.blur();
          if (data.query) void goto(clearSearchHref, { keepFocus: true, noScroll: true });
        }}
        placeholder={'Search email · "exact phrase" · from:example.com'}
        value={data.query}
      />
      <button type="submit" aria-label="Search"><Icon name="search" /></button>
      {#if data.query}<a href={clearSearchHref} aria-label="Clear search"><Icon name="close" /></a
        >{/if}
    </form>
    <button
      class="compose-button"
      onclick={() => openComposer({ mode: 'new', account: data.selectedAccount ?? undefined })}
      >Compose</button
    >
    <button class="text-button" onclick={() => window.dispatchEvent(new Event('email:drafts'))}
      >Drafts</button
    >
    <button class="text-button" aria-pressed={showChat} onclick={() => (showChat = !showChat)}
      >Chat</button
    >
    <button
      class="text-button shortcuts-button"
      type="button"
      onclick={() => {
        showShortcuts = true;
      }}>Shortcuts <kbd>?</kbd></button
    >
    <form method="GET" class="account-picker">
      <label for="account">Account</label>
      {#if data.query}<input type="hidden" name="q" value={data.query} />{/if}
      <select
        id="account"
        name="account"
        onchange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">All accounts</option>
        {#each data.accounts as account}
          <option value={account.email} selected={data.selectedAccount === account.email}
            >{account.email}</option
          >
        {/each}
      </select>
    </form>
    <a class="settings-link" href="/settings" aria-label="Settings" title="Settings"
      ><Icon name="settings" size="1.25rem" /></a
    >
  </header>

  <div class="mailbox" class:show-detail={mobileDetail} class:show-categories={showCategories}>
    <nav class="sidebar" aria-label="Mailbox">
      <p class="eyebrow">MAILBOX</p>
      {#each filters as filter}
        <button
          class="filter"
          class:active={activeFilter === filter.category}
          aria-pressed={activeFilter === filter.category}
          onclick={() => selectFilter(filter.category)}
        >
          <span class="filter-label">{filter.label}</span><span class="count">{filter.count}</span>
        </button>
      {/each}
      <p class="eyebrow app-heading">APPS</p>
      <a class="filter" href="/calendar">Calendar</a>
      <a class="filter" href="/contacts">Contacts</a>
      <a class="filter" href="/settings">Settings</a>
    </nav>

    <section class="list-pane" aria-label="Message list">
      <header class="pane-heading">
        <!-- The sidebar has the same filters, so the tabs show only when it is closed. -->
        {#if !showCategories}
          <div class="mail-tabs">
            <button class:tab-active={activeFilter === 'all'} onclick={() => selectFilter('all')}
              >All mail <small>{filterCounts.all ?? 0}</small></button
            ><button
              class:tab-active={activeFilter === 'important'}
              onclick={() => selectFilter('important')}>Important</button
            ><button
              class:tab-active={activeFilter === 'useful'}
              onclick={() => selectFilter('useful')}>Useful</button
            >
          </div>
        {/if}
        <span>{filterLabel} · {listSize}</span>
      </header>
      {#if data.searchError}<p class="search-error" role="alert">{data.searchError}</p>{/if}
      {#if data.query}<p class="search-summary">
          Search results · Best match first · Includes archived mail
        </p>{/if}
      <div
        class="message-list"
        bind:this={messageList}
        bind:clientHeight={listHeight}
        onscroll={handleListScroll}
      >
        {#if visibleEmails.length > 0}
          <ul
            aria-label="Messages"
            style:padding-top="{rowWindow.start * rowHeight}px"
            style:padding-bottom="{(visibleEmails.length - rowWindow.end) * rowHeight}px"
          >
            {#each visibleEmails.slice(rowWindow.start, rowWindow.end) as email, index (email.id)}
              <li aria-posinset={rowWindow.start + index + 1} aria-setsize={listSize}>
                <a
                  class="message"
                  href={mailboxHref({ message: email.id })}
                  data-sveltekit-keepfocus
                  data-sveltekit-noscroll
                  data-email-id={email.id}
                  class:unread={email.labels.includes('UNREAD') && !readIds.has(email.id)}
                  class:selected={selectedEmail?.id === email.id}
                  aria-current={selectedEmail?.id === email.id ? 'true' : undefined}
                >
                  <span class="sender-avatar" aria-hidden="true"
                    >{senderName(email.fromAddress).slice(0, 1).toUpperCase()}</span
                  >
                  <strong class="sender" title={email.fromAddress}
                    >{senderName(email.fromAddress)}</strong
                  >
                  <span class="message-line"
                    ><span class="subject">{email.subject || '(No subject)'}</span><span
                      class="preview"
                    >
                      — {email.snippet || 'No preview text.'}</span
                    ></span
                  >
                  <span class="category-tag"
                    >{email.category ? labels[email.category] : 'Pending'}</span
                  >
                  {#if importance(email) === 'important'}<span class="star" aria-label="Important"
                      >★</span
                    >{:else}<span></span>{/if}
                  <time title={email.accountEmail}>{formatDate(email.messageDate)}</time>
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="empty-state">
            <h3>
              {data.accounts.length === 0
                ? 'No accounts yet'
                : !data.query && (filterCounts.all ?? 0) === 0
                  ? 'No downloaded email'
                  : 'No messages here'}
            </h3>
            <p>
              {data.accounts.length === 0
                ? 'Connect an account to see your mail.'
                : !data.query && (filterCounts.all ?? 0) === 0
                  ? 'Messages will appear after your account syncs.'
                  : 'Try another search or category.'}
            </p>
          </div>
        {/if}
      </div>
    </section>

    <section class="detail-pane" aria-label="Message detail">
      <header class="pane-heading detail-toolbar">
        <button class="back-button" onclick={() => updateMailboxUrl({ message: null })}
          ><Icon name="arrow-left" /> Back to messages</button
        >
        <span
          >{selectedEmail
            ? selectedEmail.category
              ? labels[selectedEmail.category]
              : 'Needs classification'
            : 'Message detail'}</span
        >
        {#if selectedEmail && importance(selectedEmail) !== null}<span class="useful-tag"
            >{importance(selectedEmail) === 'important'
              ? 'Important'
              : importance(selectedEmail) === 'useful'
                ? 'Useful'
                : 'Other'}</span
          >{/if}
      </header>
      {#if selectedEmail}
        {#key selectedEmail.id}
          <!-- $effect.pending() read at the <main> level froze the page during navigation. -->
          {#if $effect.pending() > 0}<div class="progress" aria-hidden="true"></div>{/if}
          <article
            bind:this={readingContent}
            {@attach markReadOnOpen(selectedEmail)}
            class="reading-content"
            class:stale={$effect.pending() > 0}
            aria-busy={$effect.pending() > 0}
            tabindex="-1"
          >
            <h2>{selectedEmail.subject || '(No subject)'}</h2>
            <dl class="message-metadata">
              <div>
                <dt>From</dt>
                <dd>{selectedEmail.fromAddress || 'Unknown sender'}</dd>
              </div>
              <div>
                <dt>To</dt>
                <dd>{selectedEmail.toAddresses || 'Unknown recipient'}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{selectedEmail.accountEmail}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd title={selectedEmail.messageDate ?? undefined}>
                  {formatFullDate(selectedEmail.messageDate)}
                </dd>
              </div>
            </dl>
            <details>
              <summary>Classification details</summary>
              <div class="classification-summary" aria-label="Jev classification results">
                {#if confidence(selectedEmail)}<span
                    >Category confidence: <strong>{confidence(selectedEmail)}</strong></span
                  >{/if}
                {#if jevAnswer(selectedEmail.hasActionItem, selectedEmail.actionItemProbability)}<span
                    >Action item: <strong
                      >{jevAnswer(
                        selectedEmail.hasActionItem,
                        selectedEmail.actionItemProbability
                      )}</strong
                    ></span
                  >{/if}
                {#if jevAnswer(selectedEmail.hasReminder, selectedEmail.reminderProbability)}<span
                    >Reminder: <strong
                      >{jevAnswer(
                        selectedEmail.hasReminder,
                        selectedEmail.reminderProbability
                      )}</strong
                    ></span
                  >{/if}
              </div>
            </details>
            {#if selectedEmail.classificationError}<p class="notice">
                Classification failed. This message needs another attempt.
              </p>{/if}
            {#if selectedEmail.actionItems.length > 0 || selectedEmail.reminders.length > 0 || selectedEmail.extractionError}
              <section class="extraction-panel" aria-label="Extracted action items and reminders">
                {#if selectedEmail.actionItems.length > 0}
                  <div class="extraction-group">
                    <h3>Action items</h3>
                    <ul>
                      {#each selectedEmail.actionItems as item}
                        <li>
                          <strong>{item.title}</strong>
                          {#if item.details}<span>{item.details}</span>{/if}
                          {#if extractedDate(item.dueAt)}<small
                              >Due {extractedDate(item.dueAt)}</small
                            >{/if}
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                {#if selectedEmail.reminders.length > 0}
                  <div class="extraction-group">
                    <h3>Reminders</h3>
                    <ul>
                      {#each selectedEmail.reminders as reminder}
                        <li>
                          <strong>{reminder.title}</strong>
                          {#if reminder.details}<span>{reminder.details}</span>{/if}
                          {#if extractedDate(reminder.remindAt)}<small
                              >Reminder {extractedDate(reminder.remindAt)}</small
                            >{/if}
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                {#if selectedEmail.extractionError}<p class="notice extraction-error">
                    Extraction failed: {selectedEmail.extractionError}
                  </p>{/if}
              </section>
            {/if}
            {#if form?.error}<p class="notice action-error" role="alert">{form.error}</p>{/if}
            <div class="message-actions">
              <button
                onclick={() => openComposer({ mode: 'reply', sourceEmailId: selectedEmail!.id })}
                >Reply</button
              >
              <button
                onclick={() => openComposer({ mode: 'replyAll', sourceEmailId: selectedEmail!.id })}
                >Reply all</button
              >
              <button
                onclick={() => openComposer({ mode: 'forward', sourceEmailId: selectedEmail!.id })}
                >Forward</button
              >
              <form
                bind:this={archiveForm}
                method="POST"
                action="?/archive"
                use:enhance={submitMessageAction}
              >
                <input type="hidden" name="id" value={selectedEmail.id} />
                <button type="submit">Archive</button>
              </form>
              <form
                bind:this={deleteForm}
                method="POST"
                action="?/delete"
                use:enhance={submitMessageAction}
              >
                <input type="hidden" name="id" value={selectedEmail.id} />
                <button type="submit" class="delete-button">Delete</button>
              </form>
              {#if selectedEmail.bodyHtml && hasRemoteImages(selectedEmail.bodyHtml) && !remoteImagesAllowed}
                <div class="remote-images-control">
                  <button
                    type="button"
                    class="remote-images-button"
                    onclick={() => {
                      remoteImagesFor = selectedEmail.id;
                    }}>Load remote images</button
                  >
                  <button
                    type="button"
                    class="remote-images-menu"
                    aria-label="Remote image options"
                    popovertarget="remote-images-options"><Icon name="chevron-down" /></button
                  >
                  <div id="remote-images-options" class="remote-images-options" popover="auto">
                    {#if senderAddress(selectedEmail.fromAddress)}
                      <form
                        method="POST"
                        action="?/saveRemoteImageRule"
                        use:enhance={saveRemoteImageRule}
                      >
                        <input type="hidden" name="id" value={selectedEmail.id} />
                        <input type="hidden" name="kind" value="address" />
                        <button type="submit"
                          >Always load from {senderAddress(selectedEmail.fromAddress)}</button
                        >
                      </form>
                      <form
                        method="POST"
                        action="?/saveRemoteImageRule"
                        use:enhance={saveRemoteImageRule}
                      >
                        <input type="hidden" name="id" value={selectedEmail.id} />
                        <input type="hidden" name="kind" value="domain" />
                        <button type="submit"
                          >Always load from {senderDomain(selectedEmail.fromAddress)}</button
                        >
                      </form>
                    {:else}<p>No sender address is available for this message.</p>{/if}
                  </div>
                </div>
              {/if}
            </div>
            {#if selectedEmail.bodyHtml}
              <div class="message-paper">
                <iframe
                  class="html-message"
                  title="Email message content"
                  sandbox="allow-same-origin"
                  referrerpolicy="no-referrer"
                  srcdoc={buildEmailDocument(selectedEmail.bodyHtml, remoteImagesAllowed)}
                  {@attach messageFrame}
                ></iframe>
              </div>
            {:else}
              <div class="message-body">
                {selectedEmail.bodyText || selectedEmail.snippet || 'No message text available.'}
              </div>
            {/if}
            {#if selectedEmail.bodyTruncated}<p class="notice">
                Only part of this message was downloaded.
              </p>{/if}
          </article>
        {/key}
      {:else}
        <div class="detail-empty">
          <span aria-hidden="true">@</span>
          <h2>No message selected</h2>
          <p>Choose a category and a message to read it here.</p>
        </div>
      {/if}
    </section>
    <CalendarRail calendars={data.calendars} events={data.calendarEvents} day={data.calendarDay} />
  </div>
  {#if showChat}{#key data.selectedAccount}<EmailChat
        account={data.selectedAccount}
        close={() => (showChat = false)}
      />{/key}{/if}
  <!-- A click on the dialog element itself is a click on its backdrop. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <dialog
    bind:this={shortcutDialog}
    class="shortcut-dialog"
    aria-labelledby="shortcut-heading"
    onclose={() => (showShortcuts = false)}
    onclick={(event) => {
      if (event.target === event.currentTarget) showShortcuts = false;
    }}
  >
    <div class="shortcut-body">
      <div class="shortcut-heading">
        <h2 id="shortcut-heading">Keyboard shortcuts</h2>
        <button
          type="button"
          aria-label="Close keyboard shortcuts"
          onclick={() => {
            showShortcuts = false;
          }}><Icon name="close" size="1.25rem" /></button
        >
      </div>
      <dl>
        <div>
          <dt><kbd>C</kbd></dt>
          <dd>Compose a new message</dd>
        </div>
        <div>
          <dt><kbd>R</kbd></dt>
          <dd>Reply to the selected message</dd>
        </div>
        <div>
          <dt><kbd>A</kbd></dt>
          <dd>Reply all to the selected message</dd>
        </div>
        <div>
          <dt><kbd>F</kbd></dt>
          <dd>Forward the selected message</dd>
        </div>
        <div>
          <dt><kbd>J</kbd></dt>
          <dd>Next message</dd>
        </div>
        <div>
          <dt><kbd>K</kbd></dt>
          <dd>Previous message</dd>
        </div>
        <div>
          <dt><kbd>E</kbd></dt>
          <dd>Archive selected message</dd>
        </div>
        <div>
          <dt><kbd>#</kbd></dt>
          <dd>Move selected message to Trash</dd>
        </div>
        <div>
          <dt><kbd>O</kbd> <kbd>Enter</kbd></dt>
          <dd>Open selected message</dd>
        </div>
        <div>
          <dt><kbd>U</kbd> <kbd>Esc</kbd></dt>
          <dd>Return to the message list</dd>
        </div>
        <div>
          <dt><kbd>/</kbd></dt>
          <dd>Search email</dd>
        </div>
        <div>
          <dt><kbd>Esc</kbd></dt>
          <dd>Clear search (in the search field)</dd>
        </div>
        <div>
          <dt><kbd>?</kbd></dt>
          <dd>Show or hide this list</dd>
        </div>
      </dl>
    </div>
  </dialog>
</main>

<style>
  button {
    cursor: pointer;
    color: inherit;
  }
  button:focus-visible,
  .message:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -3px;
  }
  h1,
  h2,
  h3,
  p {
    margin: 0;
  }
  main {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--color-border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .menu-button {
    background: none;
    border: 0;
    font-size: 1.1rem;
    color: var(--color-text-muted);
  }
  h1 {
    font-size: 0.95rem;
    letter-spacing: -0.035em;
    white-space: nowrap;
  }
  .compose-button {
    margin-left: auto;
    border: 0;
    border-radius: var(--radius-md);
    padding: 8px 14px;
    background: var(--color-accent);
    color: var(--color-on-accent);
    font-size: var(--text-sm);
    font-weight: 650;
    white-space: nowrap;
  }
  .compose-button:hover {
    background: var(--color-accent-hover);
  }
  .text-button {
    border: 0;
    border-radius: var(--radius-md);
    padding: 8px;
    background: none;
    color: var(--color-accent);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .text-button:hover,
  .text-button[aria-pressed='true'] {
    background: var(--color-accent-bg-subtle);
  }
  .settings-link {
    padding: 8px;
    color: var(--color-text-muted);
  }
  .settings-link:hover {
    color: var(--color-text);
  }
  .app-heading {
    margin-top: 24px;
  }
  a.filter {
    text-decoration: none;
  }
  .account-picker {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .account-picker select {
    max-width: 220px;
  }
  .account-picker label {
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }
  kbd {
    display: inline-block;
    min-width: 1.5em;
    padding: 2px 5px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: 0.75rem var(--font-mono);
    text-align: center;
  }
  select {
    min-width: 0;
    max-width: 100%;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    padding: 8px 12px;
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
  }
  .mailbox {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 210px;
  }
  .sidebar {
    display: none;
    padding: 24px 12px;
    overflow-y: auto;
    border-right: 1px solid var(--color-border);
  }
  .eyebrow {
    padding: 0 12px 16px;
    color: var(--color-text-faint);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.14em;
  }
  .filter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
    border: 0;
    border-radius: var(--radius-md);
    padding: 12px;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 0.85rem;
  }
  .filter:nth-of-type(3) {
    margin-bottom: 20px;
  }
  .filter:hover {
    background: var(--color-surface-raised);
  }
  .filter.active {
    background: var(--color-accent-bg);
    color: var(--color-accent-text);
    font-weight: 650;
  }
  .filter-label {
    overflow-wrap: anywhere;
  }
  .count {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  .list-pane,
  .detail-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .list-pane {
    border-right: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .pane-heading {
    min-height: 48px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--color-border);
  }
  .pane-heading > span {
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  .message-list {
    position: relative;
    overflow-y: auto;
    overflow-anchor: none;
    flex: 1;
  }
  .message-list ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .message {
    display: grid;
    grid-template-columns: 24px minmax(120px, 19%) minmax(0, 1fr) auto 14px 72px;
    align-items: center;
    gap: 9px;
    width: 100%;
    height: 40px;
    padding: 0 16px;
    text-align: left;
    border: 0;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--color-text-muted);
    text-decoration: none;
    font-size: var(--text-sm);
  }
  .message:hover {
    background: var(--color-surface-hover);
  }
  .message.selected {
    background: var(--color-accent-bg);
    border-left-color: var(--color-accent);
  }
  .message.selected,
  .message.selected .preview {
    color: var(--color-text-secondary);
  }
  .sender-avatar {
    display: grid;
    place-items: center;
    width: 21px;
    height: 21px;
    border-radius: var(--radius-md);
    background: var(--color-avatar-bg);
    color: var(--color-avatar-text);
    font-size: var(--text-xs);
  }
  .sender,
  .subject {
    font-weight: 400;
  }
  .sender,
  .message-line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .unread .sender,
  .unread .subject,
  .unread time {
    color: var(--color-text);
    font-weight: 650;
  }
  .preview {
    color: var(--color-text-faint);
  }
  .category-tag {
    padding: 2px 5px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-raised);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .star {
    color: var(--color-star);
  }
  time {
    text-align: right;
    white-space: nowrap;
    font-size: var(--text-xs);
  }
  .mail-tabs {
    display: flex;
    gap: 6px;
  }
  .mail-tabs button {
    border: 0;
    border-radius: var(--radius-md);
    padding: 5px 8px;
    color: var(--color-text-muted);
    background: none;
    font-size: 0.8rem;
  }
  .mail-tabs .tab-active {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }
  .mail-tabs small {
    color: var(--color-text-muted);
  }
  .mailbox.show-detail {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 210px;
  }
  .mailbox.show-categories {
    grid-template-columns: 180px minmax(0, 1fr) 210px;
  }
  .mailbox.show-categories.show-detail {
    grid-template-columns: 180px minmax(0, 1fr) minmax(0, 1fr) 210px;
  }
  .show-categories .sidebar {
    display: block;
  }
  .show-detail .detail-pane {
    display: flex;
  }
  .show-detail .category-tag {
    display: none;
  }
  .show-detail .message {
    grid-template-columns: 22px minmax(90px, 23%) minmax(0, 1fr) 14px 66px;
    padding-inline: 10px;
  }
  details {
    margin-top: 12px;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .useful-tag {
    display: inline-block;
    border-radius: var(--radius-sm);
    padding: 3px 6px;
    font-size: var(--text-xs);
    font-weight: 700;
  }
  .useful-tag {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }
  .detail-pane {
    display: none;
    border-right: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .reading-content {
    padding: 24px;
    overflow-y: auto;
    overflow-wrap: anywhere;
  }
  /* The old message stays visible, dimmed, while the next one loads. */
  .reading-content.stale {
    opacity: 0.5;
    transition: opacity var(--motion-fast) ease-out;
  }
  .detail-pane {
    position: relative;
  }
  .progress {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--color-accent), transparent);
    background-size: 50% 100%;
    background-repeat: no-repeat;
    animation: progress 1s linear infinite;
  }
  @keyframes progress {
    from {
      background-position: -50% 0;
    }
    to {
      background-position: 150% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .progress {
      animation: none;
      background: var(--color-accent);
    }
  }
  /* Focus moves here by script so keys act on the message; it is not a control. */
  .reading-content:focus {
    outline: none;
  }
  .reading-content h2 {
    font-size: 1.05rem;
    line-height: 1.35;
    letter-spacing: -0.025em;
  }
  .message-metadata {
    margin: 24px 0 12px;
    font-size: 0.8rem;
    line-height: 1.6;
  }
  .message-metadata > div {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    margin-top: 4px;
  }
  dt {
    color: var(--color-text-faint);
  }
  dd {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .classification-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin-top: 16px;
    color: var(--color-text-faint);
    font-size: 0.75rem;
  }
  .classification-summary strong {
    color: var(--color-text);
    font-weight: 600;
  }
  .extraction-panel {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-top: 24px;
    padding: 16px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .extraction-group {
    min-width: 0;
  }
  .extraction-group h3 {
    color: var(--color-accent-text);
    font-size: 0.78rem;
    letter-spacing: 0.02em;
  }
  .extraction-group ul {
    display: grid;
    gap: 12px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }
  .extraction-group li {
    display: grid;
    gap: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--color-border);
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .extraction-group li:first-child {
    padding-top: 0;
    border-top: 0;
  }
  .extraction-group li strong {
    color: var(--color-text);
    font-weight: 650;
  }
  .extraction-group li span {
    color: var(--color-text-secondary);
  }
  .extraction-group li small {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .message-body {
    margin-top: 28px;
    padding-top: 28px;
    border-top: 1px solid var(--color-border);
    white-space: pre-wrap;
    line-height: 1.75;
    font-size: 0.92rem;
    color: var(--color-text);
  }
  .message-paper {
    margin-top: 28px;
    padding: 16px;
    border-radius: var(--radius-md);
    background: var(--color-paper);
  }
  .html-message {
    display: block;
    width: 100%;
    height: 60dvh;
    border: 0;
    background: var(--color-paper);
    color-scheme: light;
    opacity: 0;
    transition: opacity var(--motion-fast) ease-out;
  }
  .html-message:global([data-loaded]) {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .html-message {
      transition: none;
    }
  }
  .notice {
    margin-top: 20px;
    color: var(--color-warning);
    font-size: 0.8rem;
  }
  .action-error {
    color: var(--color-danger);
  }
  .extraction-error {
    grid-column: 1 / -1;
    margin-top: 0;
  }
  .message-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 20px;
  }
  .message-actions button {
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-sm);
    padding: 8px 14px;
    background: var(--color-accent);
    color: var(--color-bg);
    font-size: 0.8rem;
    font-weight: 650;
  }
  .message-actions .delete-button {
    border-color: var(--color-danger-border);
    background: transparent;
    color: var(--color-danger);
  }
  .remote-images-control {
    display: flex;
    position: relative;
  }
  .message-actions .remote-images-button {
    border-color: var(--color-border-strong);
    border-radius: 4px 0 0 4px;
    background: transparent;
    color: var(--color-accent-text);
  }
  .message-actions .remote-images-menu {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    padding: 8px 9px;
    border-color: var(--color-border-strong);
    border-left: 0;
    border-radius: 0 4px 4px 0;
    background: transparent;
    color: var(--color-accent-text);
  }
  .remote-images-menu:focus-visible {
    outline: 2px solid var(--color-accent);
  }
  .remote-images-options[popover] {
    position-area: block-end span-inline-end;
    inset: auto;
    margin: 4px 0 0;
    min-width: 230px;
    max-width: min(350px, 80vw);
    padding: 4px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface-raised);
    color: inherit;
    box-shadow: 0 8px 24px var(--color-shadow);
  }
  .message-actions .remote-images-options button {
    width: 100%;
    padding: 9px 10px;
    border: 0;
    background: transparent;
    color: var(--color-text);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .message-actions .remote-images-options button:hover {
    background: var(--color-border-strong);
  }
  .remote-images-options p {
    padding: 8px;
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }
  .shortcut-dialog {
    width: min(420px, calc(100% - 40px));
    padding: 0;
    color: inherit;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    box-shadow: 0 20px 60px var(--color-shadow);
  }
  .shortcut-body {
    padding: 24px;
  }
  .shortcut-dialog::backdrop {
    background: var(--color-backdrop);
  }
  .shortcut-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .shortcut-heading h2 {
    font-size: 1.1rem;
  }
  .shortcut-heading button {
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 1.5rem;
    cursor: pointer;
  }
  .shortcut-dialog dl {
    margin: 20px 0 0;
  }
  .shortcut-dialog dl > div {
    display: grid;
    grid-template-columns: 90px 1fr;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid var(--color-border);
  }
  .shortcut-dialog dt {
    display: flex;
    gap: 4px;
  }
  .shortcut-dialog dd {
    margin: 0;
    color: var(--color-text);
    font-size: 0.85rem;
  }
  .empty-state {
    padding: 32px 20px;
  }
  .empty-state h3 {
    font-size: 1rem;
  }
  .empty-state p,
  .detail-empty p {
    margin-top: 10px;
    color: var(--color-text-muted);
    font-size: 0.85rem;
    line-height: 1.6;
  }
  .detail-empty {
    margin: auto;
    padding: 32px;
    text-align: center;
  }
  .detail-empty > span {
    display: block;
    margin-bottom: 20px;
    font-size: 3rem;
    color: var(--color-border-strong);
  }
  .detail-empty h2 {
    font-size: 1.2rem;
  }
  .back-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 0;
    padding: 8px 0;
    color: var(--color-accent);
    font-size: 0.8rem;
  }
  .search-form {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 180px;
    max-width: 560px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }
  .search-form input {
    width: 100%;
    min-width: 0;
    padding: 8px 10px;
    background: transparent;
    border: 0;
    color: var(--color-text);
    font: inherit;
    font-size: 0.75rem;
  }
  .search-form button {
    border: 0;
    background: none;
    padding: 4px 10px;
    font-size: 1.2rem;
    color: var(--color-text-secondary);
  }
  .search-form a {
    padding: 0 10px;
    color: var(--color-text-secondary);
    text-decoration: none;
  }
  .search-summary,
  .search-error {
    padding: 8px 16px;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
  }
  .search-error {
    color: var(--color-danger);
  }
  @media (max-width: 760px) {
    .search-form {
      order: 5;
      flex-basis: 100%;
      max-width: none;
    }
  }
  @media (max-width: 1100px) {
    .account-picker label,
    .shortcuts-button {
      display: none;
    }
    .mailbox > :global(aside) {
      display: none;
    }
    .mailbox {
      grid-template-columns: minmax(0, 1fr);
    }
    .mailbox.show-detail {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .mailbox.show-categories {
      grid-template-columns: 160px minmax(0, 1fr);
    }
    .mailbox.show-categories.show-detail {
      grid-template-columns: 160px minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  @media (max-width: 760px) {
    .masthead {
      flex-wrap: wrap;
      gap: 10px;
    }
    .account-picker {
      margin-left: auto;
    }
    .account-picker label,
    .shortcuts-button {
      display: none;
    }
    .mailbox,
    .mailbox.show-detail,
    .mailbox.show-categories,
    .mailbox.show-categories.show-detail {
      grid-template-columns: minmax(0, 1fr);
    }
    .show-categories .sidebar {
      display: flex;
      overflow-x: auto;
      padding: 6px;
    }
    .show-categories {
      grid-template-rows: auto minmax(0, 1fr);
    }
    .eyebrow {
      display: none;
    }
    .filter {
      width: auto;
      flex-shrink: 0;
      gap: 8px;
    }
    .filter:nth-of-type(3) {
      margin-bottom: 0;
    }
    .show-detail .list-pane {
      display: none;
    }
    .message {
      grid-template-columns: 22px 96px minmax(0, 1fr) 60px;
      padding-inline: 8px;
      height: 44px;
    }
    .message > .category-tag,
    .message > .star,
    .message > span:empty {
      display: none;
    }
    .pane-heading > span {
      display: none;
    }
    .detail-toolbar {
      flex-wrap: wrap;
    }
    .extraction-panel {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
