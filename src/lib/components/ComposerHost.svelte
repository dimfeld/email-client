<script lang="ts">
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import {
    UNDO_SEND_SECONDS,
    type ComposeRequest,
    type Draft,
    type DraftInput,
  } from '$lib/composer';
  import RecipientField from './RecipientField.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  let {
    data,
  }: {
    data: {
      accounts: { email: string; connected: boolean }[];
      contacts: { name: string; emails: string[]; account: string }[];
      drafts: Draft[];
    };
  } = $props();
  let draft = $state<Draft | null>(null);
  let minimized = $state(false);
  let expanded = $state(false);
  let showDrafts = $state(false);
  let error = $state('');
  let dirty = $state(false);
  let saving = $state(false);
  let busy = $state(false);
  let now = $state(Date.now());
  let savePromise: Promise<boolean> | undefined;
  let editable = $derived(draft?.status === 'draft' || draft?.status === 'failed');
  let contacts = $derived(
    data.contacts.filter((contact) => contact.account === draft?.accountEmail)
  );
  let queued = $derived(
    data.drafts.filter(
      (item) => item.status === 'queued' || item.status === 'sending' || item.status === 'uncertain'
    )
  );

  async function request(command: Record<string, unknown> | FormData): Promise<Draft> {
    const response = await fetch(
      '/api/composer',
      command instanceof FormData
        ? { method: 'POST', body: command }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(command),
          }
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Composer request failed.');
    window.dispatchEvent(new Event('email:state'));
    return result;
  }
  function changed() {
    dirty = true;
    queueMicrotask(() => {
      if (!savePromise && !busy) void save();
    });
  }
  function save(): Promise<boolean> {
    if (savePromise) return savePromise;
    if (!draft || !editable || !dirty) return Promise.resolve(true);
    savePromise = (async () => {
      if (!draft || !editable) return true;
      saving = true;
      try {
        while (dirty && draft) {
          const input: DraftInput = {
            accountEmail: draft.accountEmail,
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            html: draft.html,
            text: draft.text,
          };
          const id: string = draft.id;
          dirty = false;
          const saved = await request({ action: 'save', id, version: draft.version, input });
          if (draft?.id === id) {
            draft.version = saved.version;
            draft.status = saved.status;
            draft.updatedAt = saved.updatedAt;
          }
        }
        error = '';
        return true;
      } catch (failure) {
        dirty = true;
        error = failure instanceof Error ? failure.message : 'Draft save failed.';
        return false;
      } finally {
        saving = false;
        savePromise = undefined;
      }
    })();
    return savePromise;
  }
  async function open(input: ComposeRequest) {
    if (busy || !(await save())) return;
    busy = true;
    error = '';
    try {
      if (input.draftId) {
        const response = await fetch(`/api/composer?id=${encodeURIComponent(input.draftId)}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        draft = result;
      } else draft = await request({ action: 'create', ...input });
      dirty = false;
      minimized = false;
      showDrafts = false;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Could not open composer.';
    } finally {
      busy = false;
    }
  }
  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!draft || busy || !(await save())) return;
    busy = true;
    try {
      const result = await request({
        action: name,
        id: draft.id,
        version: draft.version,
        ...extra,
      });
      if (name === 'discard') draft = null;
      else {
        now = Date.now();
        draft = result;
        dirty = false;
      }
      error = '';
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'The action failed.';
    } finally {
      busy = false;
    }
  }
  async function attach(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!draft || !(await save())) return;
    busy = true;
    try {
      for (const file of files) {
        const fields = new FormData();
        fields.set('id', draft.id);
        fields.set('version', String(draft.version));
        fields.set('file', file);
        draft = await request(fields);
      }
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Attachment upload failed.';
    } finally {
      busy = false;
      if (dirty) void save();
    }
  }
  async function close() {
    if (!(await save())) return;
    draft = null;
  }
  onMount(() => {
    const compose = (event: Event) => void open((event as CustomEvent<ComposeRequest>).detail);
    const list = () => {
      showDrafts = !showDrafts;
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || saving) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('email:compose', compose);
    window.addEventListener('email:drafts', list);
    window.addEventListener('beforeunload', unload);
    // The countdown uses seconds, matching the configured Undo Send delay.
    const clock = setInterval(() => (now = Date.now()), 1000);
    return () => {
      window.removeEventListener('email:compose', compose);
      window.removeEventListener('email:drafts', list);
      window.removeEventListener('beforeunload', unload);
      clearInterval(clock);
    };
  });
  $effect(() => {
    if (!draft || editable || busy) return;
    const current = data.drafts.find((item) => item.id === draft?.id);
    if (current && current.version >= draft.version) draft = current;
    else if (!current && (draft.status === 'sending' || draft.status === 'queued')) {
      const id = draft.id;
      void fetch(`/api/composer?id=${id}`)
        .then((response) => response.json())
        .then((result) => {
          if (draft?.id === id && result.id) draft = result;
        });
    }
  });
</script>

{#if error && !draft}<div class="global-error" role="alert">
    {error}<button onclick={() => (error = '')} aria-label="Close error"
      ><Icon name="close" /></button
    >
  </div>{/if}
{#if showDrafts}
  <section class="draft-list" aria-label="Drafts and outbox">
    <header>
      <h2>Drafts and outbox</h2>
      <button onclick={() => (showDrafts = false)} aria-label="Close draft list"
        ><Icon name="close" /></button
      >
    </header>
    {#each data.drafts as item}<button
        class="draft-row"
        onclick={() => open({ mode: item.mode, draftId: item.id })}
        ><strong>{item.subject || '(No subject)'}</strong><span
          >{item.to || 'No recipient'} · {item.status}</span
        ><small>{item.accountEmail}</small></button
      >{:else}<p>No saved drafts.</p>{/each}
  </section>
{/if}
{#if queued.length && !draft && !showDrafts}<button
    class="outbox-notice"
    onclick={() => (showDrafts = true)}
    >{queued.length} {queued.length === 1 ? 'message' : 'messages'} in outbox · Open</button
  >{/if}
{#if draft}
  <div
    tabindex="-1"
    class="composer"
    class:minimized
    class:expanded
    role="dialog"
    aria-modal="false"
    aria-label="Email composer"
  >
    <header>
      <strong>{draft.subject || 'New message'}</strong><span class="save-status" aria-live="polite"
        >{saving
          ? 'Saving…'
          : dirty
            ? 'Unsaved changes'
            : draft.status === 'draft'
              ? 'Draft saved'
              : draft.status}</span
      ><button
        aria-label={minimized ? 'Restore composer' : 'Minimize composer'}
        onclick={() => (minimized = !minimized)}><Icon name="minimize" /></button
      ><button
        aria-label={expanded ? 'Reduce composer' : 'Expand composer'}
        onclick={() => (expanded = !expanded)}
        ><Icon name={expanded ? 'collapse' : 'expand'} /></button
      ><button aria-label="Save and close composer" disabled={busy} onclick={close}
        ><Icon name="close" /></button
      >
    </header>
    <div class="compose-body">
      {#if editable}
        {#if draft.error}<p class="error" role="alert">{draft.error}</p>{/if}
        <fieldset disabled={busy}>
          <div class="field">
            <label for="compose-from">From</label><select
              id="compose-from"
              bind:value={draft.accountEmail}
              onchange={changed}
              >{#each data.accounts as account}<option value={account.email}
                  >{account.email}{account.connected ? '' : ' (reconnect to send)'}</option
                >{/each}</select
            >
          </div>
          <RecipientField
            label="To"
            bind:value={draft.to}
            {contacts}
            onchange={changed}
          /><RecipientField
            label="Cc"
            bind:value={draft.cc}
            {contacts}
            onchange={changed}
          /><RecipientField label="Bcc" bind:value={draft.bcc} {contacts} onchange={changed} />
          <div class="field">
            <label for="compose-subject">Subject</label><input
              id="compose-subject"
              bind:value={draft.subject}
              oninput={changed}
            />
          </div>
          {#key draft.id}<RichTextEditor
              html={draft.html}
              disabled={busy}
              onchange={(html, text) => {
                if (draft) {
                  draft.html = html;
                  draft.text = text;
                  changed();
                }
              }}
            />{/key}
        </fieldset>
        {#if draft.attachments.length}<ul class="attachments">
            {#each draft.attachments as file}<li>
                <span>{file.filename} ({Math.ceil(file.size / 1024)} KB)</span><button
                  aria-label={`Remove ${file.filename}`}
                  disabled={busy}
                  onclick={() => action('removeAttachment', { attachmentId: file.id })}
                  ><Icon name="close" /></button
                >
              </li>{/each}
          </ul>{/if}
      {:else if draft.status === 'queued'}
        <div class="send-status" role="status">
          <h2>Ready to send</h2>
          <p>Sending in {Math.max(0, Math.ceil(((draft.sendAt ?? now) - now) / 1000))} seconds.</p>
          <p>{draft.to}</p>
          <button class="primary" disabled={busy} onclick={() => action('undo')}>Undo Send</button>
        </div>
      {:else if draft.status === 'sending'}<div class="send-status" role="status">
          <h2>Sending…</h2>
          <p>The message is being sent to Gmail.</p>
        </div>
      {:else if draft.status === 'sent'}<div class="send-status" role="status">
          <h2>Message sent</h2>
          <button onclick={close}>Close</button>
        </div>
      {:else if draft.status === 'uncertain'}<div class="send-status">
          <h2>Check send status</h2>
          <p>{draft.error}</p>
          <p>Check Gmail Sent mail before sending this message again.</p>
          <button disabled={busy} onclick={() => action('check')}>Check sent status</button><button
            disabled={busy}
            onclick={() => {
              if (
                window.confirm(
                  'Have you checked Gmail Sent mail and confirmed that this message was not sent?'
                )
              )
                void action('recover', { checkedSent: true });
            }}>Return to draft</button
          >
        </div>{/if}
      {#if error}<p class="error" role="alert">
          {error}{#if dirty}<button onclick={() => save()}>Retry save</button>{/if}
        </p>{/if}
    </div>
    {#if editable}<footer>
        <button class="primary" disabled={busy || saving} onclick={() => action('queue')}
          >Send</button
        ><span>Undo for {UNDO_SEND_SECONDS} seconds</span><label class="attach"
          >Attach files<input type="file" multiple disabled={busy} onchange={attach} /></label
        ><button
          disabled={busy}
          onclick={() => {
            if (window.confirm('Discard this draft and its attachments?')) void action('discard');
          }}>Discard</button
        >
      </footer>{/if}
  </div>
{/if}

<style>
  .composer,
  .draft-list {
    position: fixed;
    z-index: 20;
    right: 24px;
    bottom: 20px;
    width: min(680px, calc(100vw - 32px));
    max-height: calc(100dvh - 40px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-lg);
    box-shadow: 0 16px 70px var(--color-shadow);
    background: var(--color-surface);
    color: var(--color-text);
    overflow: hidden;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }
  .composer.expanded {
    width: min(1000px, calc(100vw - 32px));
    height: calc(100dvh - 40px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--color-border);
  }
  header strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    font-size: 0.85rem;
  }
  .save-status {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  button,
  select,
  input {
    font: inherit;
  }
  button {
    cursor: pointer;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-hover);
    color: var(--color-text);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
    font-size: 0.8rem;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  header button {
    border: 0;
    padding: 3px 6px;
    font-size: 1.1rem;
  }
  .compose-body {
    overflow-y: auto;
    flex: 1;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  fieldset:disabled {
    opacity: 0.6;
    pointer-events: none;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--color-border-strong);
  }
  .field label {
    width: 42px;
    flex: none;
    font-size: 0.78rem;
    color: var(--color-text-muted);
  }
  .field input,
  .field select {
    width: 100%;
    min-width: 0;
    background: transparent;
    color: var(--color-text);
    border: 0;
    outline: none;
    font-size: 0.82rem;
  }
  footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px;
    border-top: 1px solid var(--color-border-strong);
  }
  footer span {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-right: auto;
  }
  .primary {
    background: var(--color-accent-hover);
    color: var(--color-bg);
    border-color: var(--color-accent-hover);
    font-weight: 600;
  }
  .attach {
    font-size: 0.75rem;
    cursor: pointer;
  }
  .attach input {
    display: none;
  }
  .attachments {
    list-style: none;
    padding: 0 14px;
    font-size: 0.75rem;
  }
  .attachments li {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 6px 0;
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--color-danger);
    font-size: 0.8rem;
    padding: 12px;
  }
  .error button {
    margin-left: 10px;
  }
  .send-status {
    padding: 28px;
    font-size: 0.85rem;
  }
  .send-status h2 {
    font-size: 1.1rem;
    margin: 0 0 12px;
  }
  .send-status p {
    line-height: 1.6;
  }
  .send-status button {
    margin-right: 10px;
  }
  .minimized {
    width: min(380px, calc(100vw - 32px));
    height: auto;
  }
  .minimized .compose-body,
  .minimized footer {
    display: none;
  }
  .draft-list {
    width: min(460px, calc(100vw - 32px));
    overflow-y: auto;
  }
  .draft-list h2 {
    font-size: 1rem;
    margin: 0 auto 0 0;
  }
  .draft-list p {
    padding: 20px;
  }
  .draft-row {
    display: grid;
    gap: 5px;
    text-align: left;
    border: 0;
    border-bottom: 1px solid var(--color-border-strong);
    padding: 14px;
    background: none;
    border-radius: 0;
  }
  .draft-row span,
  .draft-row small {
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
  }
  .global-error,
  .outbox-notice {
    position: fixed;
    z-index: 22;
    bottom: 20px;
    left: 20px;
    padding: 14px;
    background: var(--color-accent-bg-subtle);
    color: var(--color-text);
    border-radius: var(--radius-md);
    max-width: calc(100vw - 40px);
  }
  .global-error button {
    margin-left: 12px;
  }
  @media (max-width: 760px) {
    .composer,
    .draft-list {
      right: 8px;
      bottom: 8px;
      width: calc(100vw - 16px);
      max-height: calc(100dvh - 16px);
    }
    .save-status {
      display: none;
    }
  }
</style>
