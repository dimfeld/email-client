<script lang="ts">
  import Icon from './Icon.svelte';
  import { onDestroy, onMount } from 'svelte';
  import {
    linkMessageReferences,
    type ChatAnswer,
    type ChatMessage,
    type ChatProgress,
  } from '$lib/email-chat';
  import { readChatStream } from '$lib/chat-stream';
  import { openComposer } from '$lib/composer';
  let {
    account,
    currentMessageId,
    close,
  }: { account: string | null; currentMessageId: number | null; close: () => void } = $props();
  let messages = $state<
    (ChatMessage & {
      sources?: ChatAnswer['sources'];
      actions?: ChatAnswer['actions'];
      references?: ChatAnswer['references'];
      progress?: ChatProgress[];
    })[]
  >([]);
  let progress = $state<ChatProgress[]>([]);
  let draftAnswer = $state('');
  let threadMessageId = $state<number | null>(null);
  let question = $state('');
  let pending = $state(false);
  let error = $state('');
  let questionField: HTMLTextAreaElement;
  let controller: AbortController | undefined;
  onMount(() => questionField.focus());
  onDestroy(() => controller?.abort());
  async function ask(content: string) {
    if (!content.trim() || pending) return;
    content = content.trim();
    if (messages.length === 0) threadMessageId = currentMessageId;
    question = '';
    error = '';
    progress = [];
    draftAnswer = '';
    const history: ChatMessage[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user', content },
    ];
    messages.push({ role: 'user', content });
    pending = true;
    controller = new AbortController();
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account, currentMessageId: threadMessageId, messages: history }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? 'Email chat failed.');
      }
      if (!response.body) throw new Error('The chat stream is not available.');
      const result = await readChatStream(
        response.body,
        (update) => {
          const index = progress.findIndex((item) => item.id === update.id);
          if (index < 0) progress = [...progress, update];
          else progress = progress.map((item, position) => (position === index ? update : item));
        },
        (text) => (draftAnswer = text)
      );
      messages.push({
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
        actions: result.actions,
        references: result.references,
        progress: [...progress],
      });
      progress = [];
      draftAnswer = '';
    } catch (failure) {
      error = controller.signal.aborted
        ? 'Search stopped.'
        : failure instanceof Error
          ? failure.message
          : 'Email chat failed.';
      messages.pop();
      draftAnswer = '';
      question = content;
    } finally {
      pending = false;
    }
  }
  function newChat() {
    messages = [];
    threadMessageId = null;
    error = '';
    progress = [];
    draftAnswer = '';
  }
</script>

<section class="chat" aria-label="Chat with email">
  <header>
    <div>
      <h2>Chat with email</h2>
      <small>{account ?? 'All accounts'}</small>
    </div>
    <button onclick={close} aria-label="Close email chat"><Icon name="close" /></button>
  </header>
  <div class="conversation" aria-live="polite" aria-busy={pending}>
    {#if messages.length === 0}<p class="help">
        Ask about your downloaded mail. Find decisions, dates, or messages to review. Relevant email
        content is sent to OpenAI and, when configured, Jev.
      </p>{/if}
    {#each messages as message}
      <article class:user={message.role === 'user'}>
        <strong>{message.role === 'user' ? 'You' : 'Email assistant'}</strong>
        <p>
          {#each linkMessageReferences(message.content, message.references ?? []) as part}{#if part.href}<a
                href={part.href}>{part.text}</a
              >{:else}{part.text}{/if}{/each}
        </p>
        {#if message.progress?.length}<ul class="progress-list">
            {#each message.progress as item}<li>{item.text}</li>{/each}
          </ul>{/if}
        {#if message.sources?.length}<ul>
            {#each message.sources as source}<li>
                <a href={source.href}>[{source.id}] {source.subject}</a><small>{source.from}</small>
              </li>{/each}
          </ul>{/if}
        {#if message.actions?.length}<ul>
            {#each message.actions as action}<li>
                {#if action.kind === 'draft'}<button
                    type="button"
                    onclick={() => openComposer({ mode: 'reply', draftId: String(action.id) })}
                    >{action.label}</button
                  >
                {:else}{action.label}{/if}
              </li>{/each}
          </ul>{/if}
      </article>
    {/each}
    {#if pending && draftAnswer}<article aria-live="off">
        <strong>Email assistant</strong>
        <p>{draftAnswer}</p>
      </article>{/if}
    {#if pending || progress.length}<div class="help" role="status">
        {#if progress.length}<ul class="progress-list">
            {#each progress as item (item.id)}<li>{item.text}</li>{/each}
          </ul>{:else}<p>Working on your request…</p>{/if}
      </div>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void ask(question);
    }}
  >
    <label for="email-question">Ask a question</label><textarea
      id="email-question"
      bind:this={questionField}
      bind:value={question}
      rows="3"
      placeholder="What needs my attention this week?"
      disabled={pending}
      onkeydown={(event) => {
        if (event.metaKey && event.key === 'Enter') {
          event.preventDefault();
          if (!pending) event.currentTarget.form?.requestSubmit();
        }
      }}></textarea>
    <div>
      {#if pending}<button type="button" onclick={() => controller?.abort()}>Stop</button
        >{:else}<button type="submit" disabled={!question.trim()}>Ask</button>{/if}<button
        type="button"
        disabled={pending}
        onclick={newChat}>New chat</button
      ><button
        type="button"
        disabled={pending}
        onclick={() => {
          newChat();
          void ask(
            'Look at my recent inbox emails. Summarize what needs attention and help me decide what to do with each one. Do not change messages or create drafts until I ask.'
          );
        }}>Triage inbox</button
      >
    </div>
  </form>
</section>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    flex: 0 0 min(420px, 34vw);
    min-width: 0;
    min-height: 0;
    background: var(--color-surface);
    border-right: 1px solid var(--color-border-strong);
    color: var(--color-text);
  }
  @media (max-width: 760px) {
    .chat {
      position: fixed;
      inset: 0;
      z-index: 8;
      width: 100vw;
      background: var(--color-surface);
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px;
    border-bottom: 1px solid var(--color-border-strong);
  }
  h2 {
    margin: 0 0 4px;
    font-size: 1rem;
  }
  small {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }
  button {
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    color: var(--color-text);
    padding: 8px 12px;
    cursor: pointer;
    font: inherit;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .conversation {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
  }
  article {
    margin-bottom: 20px;
    padding: 14px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    font-size: 0.85rem;
  }
  article.user {
    background: var(--color-accent-bg);
  }
  article strong {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.6;
  }
  .help {
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }
  ul {
    padding-left: 16px;
  }
  .progress-list {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  li {
    margin-block: 10px;
  }
  a {
    color: var(--color-accent-text);
  }
  .error {
    color: var(--color-danger);
  }
  form {
    padding: 18px;
    border-top: 1px solid var(--color-border-strong);
  }
  label {
    display: block;
    font-size: 0.75rem;
    margin-bottom: 8px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    background: var(--color-bg);
    color: var(--color-text);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    padding: 10px;
    font: inherit;
  }
  form div {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
</style>
