<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { openComposer } from '$lib/composer';
  import { showToast } from '$lib/toast.svelte';
  import { MAIL_PAGE_SIZE } from '$lib/mail-list';
  import { onStateChange } from '$lib/state-change';
  import EmailChat from '$lib/components/EmailChat.svelte';
  import CalendarRail from '$lib/components/CalendarRail.svelte';
  import SwipeRow, { type SwipeActions } from '$lib/components/SwipeRow.svelte';
  import SnoozeDialog from '$lib/components/SnoozeDialog.svelte';
  import { formatSnoozeTime } from '$lib/snooze';
  import type { SwipeSide } from '$lib/swipe';
  import { deserialize, enhance } from '$app/forms';
  import { goto, onNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
  import { tick, untrack } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { effectiveImportance } from '$lib/categories';
  import { dateKeyFromDate, isDateKey } from '$lib/calendar';
  import { buildEmailDocument, emailColorMode, hasRemoteImages } from '$lib/email-html';
  import { allowsRemoteImages, senderAddress, senderDomain } from '$lib/remote-images';
  import {
    getMailAccounts,
    getMailCalendars,
    getMailCategories,
    getMailEvents,
    getMailList,
    getMailCounts,
    getRemoteImageRules,
    getSelectedThread,
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
  const mailViews = { inbox: 'Inbox', sent: 'Sent', snoozed: 'Snoozed' } as const;
  type MailView = keyof typeof mailViews;
  let mailView = $derived.by((): MailView => {
    const view = new URL(currentUrl).searchParams.get('view');
    return view === 'sent' || view === 'snoozed' ? view : 'inbox';
  });
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
    void [selectedAccount, search, activeFilter, mailView];
    return 1;
  });
  let mailList = $derived(
    await getMailList({
      account: selectedAccount,
      search,
      filter: activeFilter,
      view: mailView,
      limit: pageCount * MAIL_PAGE_SIZE,
    })
  );
  let selectedThread = $derived(
    selectedId === null ? [] : await getSelectedThread({ account: selectedAccount, id: selectedId })
  );
  let counts = $derived(
    mailView !== 'inbox' && !search ? {} : await getMailCounts({ account: selectedAccount, search })
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
      view: mailView,
      limit: pageCount * MAIL_PAGE_SIZE,
    };
  }

  // The server filters the list and counts each filter over the whole mailbox.
  let filterCounts = $derived(counts);
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
  const originalColorIds = new SvelteSet<number>();
  // Recipients are hidden until the user opens them for a message.
  const recipientIds = new SvelteSet<number>();
  let filters = $derived([
    { category: 'all' as const, label: 'All inbox', count: filterCounts.all ?? 0 },
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
    mailView !== 'inbox'
      ? visibleEmails.length
      : (filters.find((filter) => filter.category === activeFilter)?.count ?? visibleEmails.length)
  );
  let selectedEmail = $derived(selectedThread.at(-1) ?? null);
  let selectedSummary = $derived(
    emails.find(
      (email) =>
        email.threadKey === selectedEmail?.threadKey &&
        email.accountEmail === selectedEmail?.accountEmail
    ) ?? null
  );
  // The list row that J and K move to while the reading pane is closed.
  let cursorId = $state<number | null>(null);
  function remoteImagesAllowed(email: StoredEmail) {
    return remoteImagesFor === email.id || allowsRemoteImages(email.fromAddress, remoteImageRules);
  }
  function meaningfulSubject(subject: string) {
    return subject
      .replace(/^(?:(?:re|fw|fwd):\s*)+/gi, '')
      .trim()
      .toLowerCase();
  }
  let clearSearchHref = $derived(
    data.selectedAccount ? `/?account=${encodeURIComponent(data.selectedAccount)}` : '/'
  );
  let filterLabel = $derived(
    filters.find((filter) => filter.category === activeFilter)?.label ?? 'All inbox'
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

  async function updateMailboxUrl(changes: {
    category?: Filter;
    message?: number | null;
  }): Promise<void> {
    const href = mailboxHref(changes);
    if (new URL(href, currentUrl).href !== currentUrl)
      await goto(href, { keepFocus: true, noScroll: true });
  }

  function selectFilter(filter: Filter) {
    updateMailboxUrl({ category: filter, message: null });
  }
  function selectView(view: MailView) {
    const url = new URL(currentUrl);
    if (view === 'inbox') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    url.searchParams.delete('category');
    url.searchParams.delete('message');
    void goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true });
  }

  function fitMessageFrame(frame: HTMLIFrameElement, reset: boolean) {
    try {
      // A reset lets the frame shrink. Later fits only follow content growth, such as images.
      if (reset) frame.style.height = '0px';
      const root = frame.contentDocument?.documentElement;
      if (!root) return;
      frame.style.height = `${root.scrollHeight}px`;
      // A horizontal scrollbar takes height from the frame. Add that height back.
      const scrollbarHeight = root.scrollHeight - root.clientHeight;
      if (scrollbarHeight > 0) frame.style.height = `${root.scrollHeight + scrollbarHeight}px`;
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

  function formatCompactDateTime(sortTime: number): string {
    const date = new Date(sortTime);
    const now = new Date();
    const time = { hour: 'numeric', minute: '2-digit' } as const;
    if (date.toDateString() === now.toDateString()) {
      return new Intl.DateTimeFormat(undefined, time).format(date);
    }
    if (date.getFullYear() === now.getFullYear()) {
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...time }).format(
        date
      );
    }
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }

  function accountLabel(email: string): string {
    return accounts.find((account) => account.email === email)?.alias || email;
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

  // The row that has focus, or else the list cursor.
  function listCursorId(): number | null {
    const focusedId = Number(
      document.activeElement?.closest<HTMLElement>('.message')?.dataset.emailId
    );
    return Number.isInteger(focusedId) && focusedId > 0 ? focusedId : cursorId;
  }

  // J and K change the open message when the reading pane is open. When it is closed,
  // they move the list cursor and the pane stays closed.
  async function moveSelection(offset: number) {
    if (visibleEmails.length === 0) return;
    const currentId = selectedEmail ? selectedEmail.id : listCursorId();
    const currentIndex = visibleEmails.findIndex((email) => email.id === currentId);
    const nextIndex =
      currentIndex < 0
        ? offset > 0
          ? 0
          : visibleEmails.length - 1
        : Math.max(0, Math.min(visibleEmails.length - 1, currentIndex + offset));
    if (nextIndex === currentIndex && offset > 0 && data.hasMore) pageCount += 1;
    const nextId = visibleEmails[nextIndex].id;
    if (selectedId !== null) {
      updateMailboxUrl({ message: nextId });
      return;
    }
    cursorId = nextId;
    await tick();
    messageList
      ?.querySelector<HTMLElement>(`[data-email-id="${nextId}"]`)
      ?.focus({ preventScroll: true });
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

  function attachReadingContent(element: HTMLElement) {
    readingContent = element;
    if (focusReadingPaneOnLoad) {
      focusReadingPaneOnLoad = false;
      element.focus({ preventScroll: true });
    }
    return () => {
      if (readingContent === element) readingContent = null;
    };
  }

  async function focusMessage(emailId: number) {
    focusReadingPaneOnLoad = true;
    const href = mailboxHref({ message: emailId });
    if (new URL(href, currentUrl).href !== currentUrl)
      await goto(href, { keepFocus: true, noScroll: true });
    await tick();
    if (readingContent) {
      focusReadingPaneOnLoad = false;
      readingContent?.focus({ preventScroll: true });
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
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      /^[1-9]$/.test(event.key)
    ) {
      const accountIndex = Number(event.key) - 2;
      const account = event.key === '1' ? null : data.accounts[accountIndex]?.email;
      if (event.key === '1' || account) {
        event.preventDefault();
        const url = new URL(currentUrl);
        if (account) url.searchParams.set('account', account);
        else url.searchParams.delete('account');
        url.searchParams.delete('message');
        void goto(`${url.pathname}${url.search}${url.hash}`, {
          keepFocus: true,
          noScroll: true,
        });
        return;
      }
    }
    if (snoozeTarget) return;
    if (showShortcuts && event.key !== 'Escape' && event.key !== '?') return;
    if (event.key === '`' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat) {
      event.preventDefault();
      showChat = !showChat;
      return;
    }
    if (
      isInteractiveTarget(event.target) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.repeat
    )
      return;
    const key = event.key.toLowerCase();
    const eventTarget = event.target instanceof Element ? event.target : null;
    const inMessageList = !!eventTarget?.closest('.message-list');
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
    } else if (inMessageList && (event.key === 'Enter' || event.key === 'ArrowRight')) {
      const row = eventTarget?.closest<HTMLElement>('.message');
      const rowId = Number(row?.dataset.emailId);
      const emailId = Number.isInteger(rowId) && rowId > 0 ? rowId : selectedEmail?.id;
      if (emailId) {
        event.preventDefault();
        await focusMessage(emailId);
      }
    } else if (key === 'j' || (event.key === 'ArrowDown' && inMessageList)) {
      event.preventDefault();
      moveSelection(1);
    } else if (key === 'k' || (event.key === 'ArrowUp' && inMessageList)) {
      event.preventDefault();
      moveSelection(-1);
    } else if (key === 'e' && selectedEmail && archiveForm) {
      event.preventDefault();
      archiveForm.requestSubmit();
    } else if (
      (event.key === 'Delete' ||
        event.key === '#' ||
        (event.shiftKey && event.code === 'Digit3')) &&
      selectedEmail &&
      deleteForm
    ) {
      event.preventDefault();
      deleteForm.requestSubmit();
    } else if (key === 'o' || event.key === 'Enter') {
      // Enter on a focused message row follows that row's link.
      if (event.key === 'Enter' && (event.target as Element | null)?.closest?.('.message')) return;
      const emailId = selectedEmail?.id ?? listCursorId() ?? visibleEmails[0]?.id;
      if (emailId) {
        event.preventDefault();
        await focusMessage(emailId);
      }
    } else if (
      key === 'u' ||
      event.key === 'Escape' ||
      (event.key === 'ArrowLeft' && selectedEmail)
    ) {
      event.preventDefault();
      if (showShortcuts) showShortcuts = false;
      else {
        const emailId = selectedEmail?.id ?? selectedId;
        const href = mailboxHref({ message: null });
        if (new URL(href, currentUrl).href !== currentUrl)
          await goto(href, { keepFocus: true, noScroll: true });
        if (emailId) cursorId = emailId;
        await tick();
        if (emailId) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const row = messageList?.querySelector<HTMLElement>(`[data-email-id="${emailId}"]`);
          if (row?.isConnected && row.getClientRects().length > 0)
            row.focus({ preventScroll: true });
        }
      }
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

  let focusReadingPaneOnLoad = false;

  function actionError(result: ActionResult): string {
    if (result.type === 'failure' && typeof result.data?.error === 'string')
      return result.data.error;
    if (result.type === 'error') return String(result.error?.message ?? result.error);
    return 'The action failed.';
  }

  type MessageAction =
    | 'archive'
    | 'delete'
    | 'unarchive'
    | 'undelete'
    | 'markRead'
    | 'star'
    | 'unstar'
    | 'snooze'
    | 'unsnooze';

  async function postMessageAction(
    action: MessageAction,
    id: number,
    options: { succeededIds?: number[]; until?: Date } = {}
  ): Promise<ActionResult> {
    const body = new FormData();
    body.set('id', String(id));
    if (options.succeededIds) body.set('succeededIds', JSON.stringify(options.succeededIds));
    if (options.until) body.set('until', options.until.toISOString());
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
      if (
        !selectedThread.some((member) => member.labels.includes('UNREAD')) ||
        untrack(() => readIds.has(email.id))
      )
        return;
      readIds.add(email.id);
      void postMessageAction('markRead', email.id).then((result) => {
        if (result.type === 'success' && !result.data?.error) return;
        readIds.delete(email.id);
        showToast(result.type === 'success' ? String(result.data?.error) : actionError(result), {
          tone: 'error',
        });
      });
    };
  }

  const undoActions = { archive: 'unarchive', delete: 'undelete', snooze: 'unsnooze' } as const;

  async function undoMessageAction(
    id: number,
    action: ThreadAction,
    succeededIds: number[],
    rowId: number,
    wasOpen: boolean
  ) {
    const result = await postMessageAction(undoActions[action], id, { succeededIds });
    if (result.type !== 'success') {
      showToast(actionError(result), { tone: 'error' });
      return;
    }
    await getMailList(mailListArgs()).refresh();
    removedIds.delete(rowId);
    if (wasOpen) {
      focusReadingPaneOnLoad = true;
      updateMailboxUrl({ message: id });
    }
    if (typeof result.data?.message === 'string') showToast(result.data.message);
  }

  let mailTransition = Promise.resolve();
  function queueMailTransition<T>(run: () => Promise<T>): Promise<T> {
    const result = mailTransition.then(run, run);
    mailTransition = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  // The list row of the open thread that contains message `id`.
  function openThreadRowId(id: number): number {
    const target = selectedThread.find((member) => member.id === id);
    return (
      visibleEmails.find(
        (email) =>
          email.threadKey === target?.threadKey && email.accountEmail === target?.accountEmail
      )?.id ?? id
    );
  }

  async function submitMessageAction(event: SubmitEvent, action: 'archive' | 'delete') {
    event.preventDefault();
    const id = Number(new FormData(event.currentTarget as HTMLFormElement).get('id'));
    await runThreadAction(id, openThreadRowId(id), action);
  }

  type ThreadAction = 'archive' | 'delete' | 'snooze';

  // Archives, deletes, or snoozes the thread of message `id`, which the list shows as row `rowId`.
  async function runThreadAction(id: number, rowId: number, action: ThreadAction, until?: Date) {
    // When the thread is open, the next message opens after it leaves the list.
    const wasOpen =
      selectedId !== null && (selectedSummary === null || selectedSummary.id === rowId);
    const navigation = queueMailTransition(async () => {
      if (removedIds.has(rowId)) return false;
      if (action === 'archive' && mailView === 'sent') return true;
      // Open the next message, as most mail clients do, so E can process mail row by row.
      const index = visibleEmails.findIndex((email) => email.id === rowId);
      const next =
        index < 0 ? null : (visibleEmails[index + 1] ?? visibleEmails[index - 1] ?? null);
      removedIds.add(rowId);
      if (wasOpen) {
        focusReadingPaneOnLoad = next !== null;
        await updateMailboxUrl({ message: next?.id ?? null });
      }
      return true;
    });
    if (!(await navigation)) return;
    const result = await postMessageAction(action, id, { until });
    if (
      result.type === 'success' &&
      Array.isArray(result.data?.succeededIds) &&
      result.data.succeededIds.length
    ) {
      // Gmail Trash and archive are recoverable, so Undo replaces a confirmation step.
      showToast(
        typeof result.data.error === 'string'
          ? result.data.message
          : action === 'archive'
            ? 'Thread archived.'
            : action === 'snooze' && until
              ? `Thread snoozed until ${formatSnoozeTime(until)}.`
              : 'Thread moved to Trash.',
        {
          action: {
            label: 'Undo',
            run: () =>
              void undoMessageAction(
                id,
                action,
                result.data!.succeededIds as number[],
                rowId,
                wasOpen
              ),
          },
        }
      );
      if (result.data.error) {
        removedIds.delete(rowId);
        await getMailList(mailListArgs()).refresh();
        if (wasOpen) await updateMailboxUrl({ message: id });
      }
      return;
    }
    removedIds.delete(rowId);
    showToast(actionError(result), { tone: 'error' });
  }

  // A star shows at once. The list keeps the change until its next refresh.
  const starOverrides = new SvelteMap<number, boolean>();
  async function toggleStar(email: EmailSummary) {
    const starred = !(starOverrides.get(email.id) ?? email.starred ?? false);
    starOverrides.set(email.id, starred);
    const result = await postMessageAction(starred ? 'star' : 'unstar', email.id);
    if (result.type === 'success' && !result.data?.error) {
      await getMailList(mailListArgs()).refresh();
      starOverrides.delete(email.id);
      return;
    }
    starOverrides.delete(email.id);
    showToast(result.type === 'success' ? String(result.data?.error) : actionError(result), {
      tone: 'error',
    });
  }

  // The row that the snooze dialog is open for.
  let snoozeTarget = $state<{ id: number; rowId: number } | null>(null);

  // The list row that shows its swipe buttons. Only one row is open at a time.
  let swipeOpen = $state<{ id: number; side: SwipeSide } | null>(null);
  function swipeActions(email: EmailSummary, canArchive: boolean, starred: boolean) {
    const archive = {
      label: 'Archive',
      icon: 'archive',
      tone: 'archive',
      run: () => void runThreadAction(email.id, email.id, 'archive'),
    } as const;
    const remove = {
      label: 'Delete',
      icon: 'trash',
      tone: 'delete',
      run: () => void runThreadAction(email.id, email.id, 'delete'),
    } as const;
    const star = {
      label: starred ? 'Unstar' : 'Star',
      icon: 'star',
      tone: 'star',
      run: () => void toggleStar(email),
    } as const;
    const snooze = {
      label: 'Snooze',
      icon: 'clock',
      tone: 'snooze',
      run: () => (snoozeTarget = { id: email.id, rowId: email.id }),
    } as const;
    // Snooze returns a thread to the inbox, so it needs the same rows as Archive.
    return {
      left: (canArchive
        ? { buttons: [archive, remove], long: archive }
        : { buttons: [remove] }) satisfies SwipeActions,
      right: {
        buttons: canArchive ? [star, snooze] : [],
        long: star,
      } satisfies SwipeActions,
    };
  }

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
      const tasks: Promise<void>[] = [];
      if (scopes.has('mail') || scopes.has('categories')) {
        tasks.push(
          queueMailTransition(async () => {
            const account = selectedAccount;
            const id = selectedId;
            const refreshes = [getMailList(mailListArgs()).refresh()];
            if (id !== null) refreshes.push(getSelectedThread({ account, id }).refresh());
            await Promise.all(refreshes);
            await getMailCounts({ account, search }).refresh();
          })
        );
      }
      if (scopes.has('categories')) tasks.push(getMailCategories().refresh());
      if (scopes.has('calendar')) {
        const account = selectedAccount;
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

  // Keep the selected row or the list cursor visible when J and K move them.
  $effect(() => {
    const id = selectedId ?? cursorId;
    const list = messageList;
    // An open message replaces the list cursor.
    if (selectedId !== null) untrack(() => (cursorId = null));
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
      <h1>{mailViews[mailView]}</h1>
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
      <button class="filter" class:active={mailView === 'inbox'} onclick={() => selectView('inbox')}
        >Inbox</button
      >
      <button class="filter" class:active={mailView === 'sent'} onclick={() => selectView('sent')}
        >Sent</button
      >
      <button
        class="filter"
        class:active={mailView === 'snoozed'}
        onclick={() => selectView('snoozed')}>Snoozed</button
      >
      {#if mailView === 'inbox'}{#each filters as filter}
          <button
            class="filter"
            class:active={activeFilter === filter.category}
            aria-pressed={activeFilter === filter.category}
            onclick={() => selectFilter(filter.category)}
          >
            <span class="filter-label">{filter.label}</span><span class="count">{filter.count}</span
            >
          </button>
        {/each}{/if}
      <p class="eyebrow app-heading">APPS</p>
      <a class="filter" href="/calendar">Calendar</a>
      <a class="filter" href="/contacts">Contacts</a>
      <a class="filter" href="/settings">Settings</a>
    </nav>

    <section class="list-pane" aria-label="Message list">
      <header class="pane-heading">
        <!-- The sidebar has the same filters, so the tabs show only when it is closed. -->
        {#if !showCategories && mailView === 'inbox'}
          <div class="mail-tabs">
            <button class:tab-active={activeFilter === 'all'} onclick={() => selectFilter('all')}
              >All inbox <small>{filterCounts.all ?? 0}</small></button
            ><button
              class:tab-active={activeFilter === 'important'}
              onclick={() => selectFilter('important')}>Important</button
            ><button
              class:tab-active={activeFilter === 'useful'}
              onclick={() => selectFilter('useful')}>Useful</button
            >
          </div>
        {/if}
        <span>{mailView === 'inbox' ? filterLabel : mailViews[mailView]} · {listSize}</span>
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
          {@const canArchive = mailView === 'inbox' && !search}
          {@const openRow = swipeOpen}
          {@const importanceMap = importanceById}
          <ul
            aria-label="Messages"
            style:padding-top="{rowWindow.start * rowHeight}px"
            style:padding-bottom="{(visibleEmails.length - rowWindow.end) * rowHeight}px"
          >
            {#each visibleEmails.slice(rowWindow.start, rowWindow.end) as email, index (email.id)}
              {@const starred = starOverrides.get(email.id) ?? email.starred ?? false}
              {@const important = importanceMap.get(email.id) === 'important'}
              {@const swipe = swipeActions(email, canArchive, starred)}
              <li aria-posinset={rowWindow.start + index + 1} aria-setsize={listSize}>
                <SwipeRow
                  left={swipe.left}
                  right={swipe.right}
                  open={openRow?.id === email.id ? openRow.side : null}
                  onOpenChange={(side) => (swipeOpen = side ? { id: email.id, side } : null)}
                >
                  <a
                    class="message"
                    href={mailboxHref({ message: email.id })}
                    data-sveltekit-keepfocus
                    data-sveltekit-noscroll
                    data-email-id={email.id}
                    class:unread={email.unread && !readIds.has(email.id)}
                    class:selected={selectedEmail?.threadKey === email.threadKey &&
                      selectedEmail?.accountEmail === email.accountEmail}
                    aria-current={selectedEmail?.threadKey === email.threadKey &&
                    selectedEmail?.accountEmail === email.accountEmail
                      ? 'true'
                      : undefined}
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
                    {#if mailView !== 'sent'}<span class="category-tag"
                        >{email.category ? labels[email.category] : 'Pending'}</span
                      >{:else}<span></span>{/if}
                    <!-- Jev's importance and the Gmail star are separate, so each has a column. -->
                    <span class="importance" title={important ? 'Important' : undefined}
                      >{#if important}<Icon name="important" size="12px" /><span
                          class="visually-hidden">Important</span
                        >{/if}</span
                    >
                    <span class="star" aria-label={starred ? 'Starred' : undefined}
                      >{starred ? '★' : ''}</span
                    >
                    {#if email.snoozedUntil}
                      {@const until = new Date(email.snoozedUntil)}
                      <time class="snoozed-until" title={`Snoozed until ${formatSnoozeTime(until)}`}
                        >{formatDate(until.toISOString())}</time
                      >
                    {:else}
                      <time title={email.accountEmail}
                        >{formatDate(
                          email.latestSortTime
                            ? new Date(email.latestSortTime).toISOString()
                            : email.messageDate
                        )}</time
                      >
                    {/if}
                  </a>
                </SwipeRow>
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
          >{mailView === 'sent'
            ? 'Sent thread'
            : selectedSummary?.category
              ? labels[selectedSummary.category]
              : 'Message detail'}</span
        >
        {#if mailView === 'inbox' && selectedSummary && importance(selectedSummary) !== null}<span
            class="useful-tag"
            >{importance(selectedSummary) === 'important'
              ? 'Important'
              : importance(selectedSummary) === 'useful'
                ? 'Useful'
                : 'Other'}</span
          >{/if}
      </header>
      {#if selectedEmail}
        <div {@attach markReadOnOpen(selectedEmail)} class="thread-content">
          <h2 class="thread-subject">{selectedThread[0]?.subject || '(No subject)'}</h2>
          {#each selectedThread as selectedEmail, memberIndex (selectedEmail.id)}
            {@const from = selectedEmail.labels.includes('SENT')
              ? selectedEmail.accountEmail
              : selectedEmail.fromAddress}
            {@const fromAddress = senderAddress(from)}
            {@const showRecipients = recipientIds.has(selectedEmail.id)}
            <article {@attach attachReadingContent} class="reading-content" tabindex="-1">
              {#if memberIndex > 0 && meaningfulSubject(selectedEmail.subject) !== meaningfulSubject(selectedThread[memberIndex - 1].subject)}
                <h3>{selectedEmail.subject || '(No subject)'}</h3>
              {/if}
              <header class="message-header">
                <span class="account-badge" title={selectedEmail.accountEmail}
                  >{accountLabel(selectedEmail.accountEmail)}</span
                >
                <strong class="message-sender" title={from}>{senderName(from)}</strong>
                {#if fromAddress && fromAddress !== senderName(from).toLowerCase()}<span
                    class="message-sender-address">{fromAddress}</span
                  >{/if}
                <button
                  type="button"
                  class="recipients-toggle"
                  aria-expanded={showRecipients}
                  aria-label={showRecipients ? 'Hide recipients' : 'Show recipients'}
                  title={showRecipients ? 'Hide recipients' : 'Show recipients'}
                  onclick={() =>
                    showRecipients
                      ? recipientIds.delete(selectedEmail.id)
                      : recipientIds.add(selectedEmail.id)}><Icon name="chevron-down" /></button
                >
                <time
                  datetime={new Date(selectedEmail.sortTime).toISOString()}
                  title={formatFullDate(new Date(selectedEmail.sortTime).toISOString())}
                  >{formatCompactDateTime(selectedEmail.sortTime)}</time
                >
              </header>
              {#if showRecipients}<dl class="message-recipients">
                  <div>
                    <dt>To</dt>
                    <dd>{selectedEmail.toAddresses || 'Unknown recipient'}</dd>
                  </div>
                  {#if selectedEmail.headers?.cc}<div>
                      <dt>Cc</dt>
                      <dd>{selectedEmail.headers.cc}</dd>
                    </div>{/if}
                </dl>{/if}
              {#if !selectedEmail.labels.includes('SENT')}<details>
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
                </details>{/if}
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
                  class="icon-action"
                  aria-label="Reply"
                  title="Reply"
                  onclick={() => openComposer({ mode: 'reply', sourceEmailId: selectedEmail!.id })}
                  ><Icon name="reply" /></button
                >
                <button
                  class="icon-action"
                  aria-label="Reply all"
                  title="Reply all"
                  onclick={() =>
                    openComposer({ mode: 'replyAll', sourceEmailId: selectedEmail!.id })}
                  ><Icon name="reply-all" /></button
                >
                <button
                  class="icon-action"
                  aria-label="Forward"
                  title="Forward"
                  onclick={() =>
                    openComposer({ mode: 'forward', sourceEmailId: selectedEmail!.id })}
                  ><Icon name="forward" /></button
                >
                {#if selectedThread.some((member) => member.labels.includes('INBOX'))}<form
                    bind:this={archiveForm}
                    method="POST"
                    action="?/archive"
                    onsubmit={(event) => void submitMessageAction(event, 'archive')}
                  >
                    <input type="hidden" name="id" value={selectedEmail.id} />
                    <button type="submit" class="icon-action" aria-label="Archive" title="Archive"
                      ><Icon name="archive" /></button
                    >
                  </form>
                  <button
                    type="button"
                    class="icon-action"
                    aria-label="Snooze"
                    title="Snooze"
                    onclick={() =>
                      (snoozeTarget = {
                        id: selectedEmail.id,
                        rowId: openThreadRowId(selectedEmail.id),
                      })}><Icon name="clock" /></button
                  >{/if}
                <form
                  bind:this={deleteForm}
                  method="POST"
                  action="?/delete"
                  onsubmit={(event) => void submitMessageAction(event, 'delete')}
                >
                  <input type="hidden" name="id" value={selectedEmail.id} />
                  <button
                    type="submit"
                    class="icon-action delete-button"
                    aria-label="Delete"
                    title="Delete"><Icon name="trash" /></button
                  >
                </form>
                {#if selectedEmail.bodyHtml}
                  {@const menuId = `message-options-${selectedEmail.id}`}
                  <button
                    type="button"
                    class="icon-action"
                    aria-label="More actions"
                    title="More actions"
                    popovertarget={menuId}><Icon name="more" /></button
                  >
                  <div id={menuId} class="action-menu message-options" popover="auto">
                    <button
                      type="button"
                      popovertarget={menuId}
                      popovertargetaction="hide"
                      onclick={() => {
                        if (originalColorIds.has(selectedEmail.id))
                          originalColorIds.delete(selectedEmail.id);
                        else originalColorIds.add(selectedEmail.id);
                      }}
                      >{originalColorIds.has(selectedEmail.id)
                        ? 'Show in dark mode'
                        : 'Show original colors'}</button
                    >
                  </div>
                {/if}
                {#if selectedEmail.bodyHtml && hasRemoteImages(selectedEmail.bodyHtml) && !remoteImagesAllowed(selectedEmail)}
                  {@const remoteImagesMenuId = `remote-images-options-${selectedEmail.id}`}
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
                      popovertarget={remoteImagesMenuId}><Icon name="chevron-down" /></button
                    >
                    <div id={remoteImagesMenuId} class="action-menu" popover="auto">
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
                {@const colorMode = emailColorMode(
                  selectedEmail.bodyHtml,
                  originalColorIds.has(selectedEmail.id)
                )}
                <div class={['message-paper', colorMode]}>
                  <iframe
                    class="html-message"
                    title="Email message content"
                    sandbox="allow-same-origin"
                    referrerpolicy="no-referrer"
                    srcdoc={buildEmailDocument(
                      selectedEmail.bodyHtml,
                      remoteImagesAllowed(selectedEmail),
                      colorMode
                    )}
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
          {/each}
        </div>
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
  {#if snoozeTarget}
    {@const target = snoozeTarget}
    <SnoozeDialog
      onSnooze={(until) => void runThreadAction(target.id, target.rowId, 'snooze', until)}
      onClose={() => (snoozeTarget = null)}
    />
  {/if}
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
          <dt><kbd>Ctrl</kbd> + <kbd>1</kbd></dt>
          <dd>Show all accounts</dd>
        </div>
        <div>
          <dt><kbd>Ctrl</kbd> + <kbd>2–9</kbd></dt>
          <dd>Select an account by its position in the account list</dd>
        </div>
        <div>
          <dt><kbd>`</kbd></dt>
          <dd>Open chat</dd>
        </div>
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
          <dt><kbd>J</kbd> <kbd>↓</kbd></dt>
          <dd>Next message</dd>
        </div>
        <div>
          <dt><kbd>K</kbd> <kbd>↑</kbd></dt>
          <dd>Previous message</dd>
        </div>
        <div>
          <dt><kbd>E</kbd></dt>
          <dd>Archive selected message</dd>
        </div>
        <div>
          <dt><kbd>Delete</kbd> <kbd>#</kbd></dt>
          <dd>Move selected message to Trash</dd>
        </div>
        <div>
          <dt><kbd>O</kbd> <kbd>Enter</kbd> <kbd>→</kbd></dt>
          <dd>Open selected message</dd>
        </div>
        <div>
          <dt><kbd>U</kbd> <kbd>Esc</kbd> <kbd>←</kbd></dt>
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
    grid-template-columns: 24px minmax(120px, 19%) minmax(0, 1fr) auto 12px 14px 72px;
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
  .importance {
    color: var(--color-warning);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .snoozed-until {
    color: var(--color-caution);
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
    grid-template-columns: 22px minmax(90px, 23%) minmax(0, 1fr) 12px 14px 66px;
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
    overflow-wrap: anywhere;
    border-top: 1px solid var(--color-border);
  }
  .thread-content {
    overflow-y: auto;
    min-height: 0;
  }
  .thread-subject {
    padding: 20px 24px;
    margin: 0;
    font-size: 1.1rem;
  }
  /* Focus moves here by script so keys act on the message; it is not a control. */
  .reading-content:focus {
    outline: none;
  }
  .reading-content h3 {
    font-size: 1.05rem;
    line-height: 1.35;
    letter-spacing: -0.025em;
  }
  .message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin: 16px 0 8px;
    font-size: var(--text-sm);
  }
  .account-badge {
    flex: none;
    max-width: 12em;
    overflow: hidden;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--color-accent-bg-subtle);
    color: var(--color-accent-text);
    font-size: var(--text-xs);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message-sender {
    flex: none;
    max-width: 50%;
    overflow: hidden;
    color: var(--color-text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message-sender-address {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text-faint);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recipients-toggle {
    flex: none;
    display: inline-grid;
    place-items: center;
    padding: 2px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-faint);
    cursor: pointer;
    transition: transform var(--motion-fast);
  }
  .recipients-toggle:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }
  .recipients-toggle[aria-expanded='true'] {
    transform: rotate(180deg);
  }
  .message-header time {
    flex: none;
    margin-left: auto;
    color: var(--color-text-faint);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .message-recipients {
    margin: 0 0 8px;
    font-size: var(--text-xs);
    line-height: 1.5;
  }
  .message-recipients > div {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
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
    color-scheme: light;
  }
  /* Most email HTML has only light styles. Invert it to fit the dark app. */
  .message-paper.inverted {
    filter: invert(0.9) hue-rotate(180deg);
  }
  /* Emails with prefers-color-scheme styles get their own dark mode. */
  .message-paper.dark {
    background: var(--color-surface-sunken);
    color-scheme: dark;
  }
  .html-message {
    display: block;
    width: 100%;
    height: 60dvh;
    border: 0;
    background: Canvas;
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
  /* The actions stay at the top of the pane while their message is on screen. */
  .message-actions {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 10px -24px 0;
    padding: 10px 24px;
    background: var(--color-surface);
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
  .message-actions .icon-action {
    padding: 8px;
    border-color: var(--color-border-strong);
    background: transparent;
    color: var(--color-accent-text);
  }
  .message-actions .icon-action:hover {
    border-color: var(--color-border-hover);
    background: var(--color-surface-hover);
  }
  .message-actions .delete-button {
    border-color: var(--color-danger-border);
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
  .action-menu[popover] {
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
  .message-options[popover] {
    position-area: block-end span-inline-start;
  }
  .message-actions .action-menu button {
    width: 100%;
    padding: 9px 10px;
    border: 0;
    background: transparent;
    color: var(--color-text);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .message-actions .action-menu button:hover {
    background: var(--color-border-strong);
  }
  .action-menu p {
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
    .account-picker label {
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
    .account-picker label {
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
      grid-template-columns: 22px 96px minmax(0, 1fr) 12px 14px 60px;
      padding-inline: 8px;
      height: 44px;
    }
    .message > .category-tag,
    .message > span:empty:not(.star, .importance) {
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
