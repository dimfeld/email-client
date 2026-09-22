<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ChatAnswer, ChatMessage } from '$lib/email-chat';
  let { account, close }: { account: string | null; close: () => void } = $props();
  let messages = $state<(ChatMessage & { sources?: ChatAnswer['sources'] })[]>([]);
  let question = $state('');
  let pending = $state(false);
  let error = $state('');
  let controller: AbortController | undefined;
  onDestroy(() => controller?.abort());
  async function ask(event: SubmitEvent) {
    event.preventDefault();
    if (!question.trim() || pending) return;
    const content = question.trim();
    question = '';
    error = '';
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
        body: JSON.stringify({ account, messages: history }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Email chat failed.');
      messages.push({ role: 'assistant', content: result.answer, sources: result.sources });
    } catch (failure) {
      error = controller.signal.aborted
        ? 'Search stopped.'
        : failure instanceof Error
          ? failure.message
          : 'Email chat failed.';
      messages.pop();
      question = content;
    } finally {
      pending = false;
    }
  }
</script>

<section class="chat" aria-label="Chat with email">
  <header>
    <div>
      <h2>Chat with email</h2>
      <small>{account ?? 'All accounts'}</small>
    </div>
    <button onclick={close} aria-label="Close email chat">×</button>
  </header>
  <div class="conversation" aria-live="polite" aria-busy={pending}>
    {#if messages.length === 0}<p class="help">
        Ask about your downloaded mail. Find decisions, dates, or messages to review. Relevant email
        content is sent to OpenAI and, when configured, Jev.
      </p>{/if}
    {#each messages as message}
      <article class:user={message.role === 'user'}>
        <strong>{message.role === 'user' ? 'You' : 'Email assistant'}</strong>
        <p>{message.content}</p>
        {#if message.sources?.length}<ul>
            {#each message.sources as source}<li>
                <a href={source.href}>[{source.id}] {source.subject}</a><small>{source.from}</small>
              </li>{/each}
          </ul>{/if}
      </article>
    {/each}
    {#if pending}<p class="help">Searching and reading your mail…</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
  <form onsubmit={ask}>
    <label for="email-question">Ask a question</label><textarea
      id="email-question"
      bind:value={question}
      rows="3"
      placeholder="What needs my attention this week?"
      disabled={pending}></textarea>
    <div>
      {#if pending}<button type="button" onclick={() => controller?.abort()}>Stop</button
        >{:else}<button type="submit" disabled={!question.trim()}>Ask</button>{/if}<button
        type="button"
        disabled={pending}
        onclick={() => {
          messages = [];
          error = '';
        }}>New chat</button
      >
    </div>
  </form>
</section>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 8;
    width: min(520px, 100vw);
    background: var(--color-surface);
    border-left: 1px solid var(--color-border-strong);
    box-shadow: -16px 0 50px var(--color-shadow);
    color: var(--color-text);
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
    font-size: 0.7rem;
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
    font-size: 0.72rem;
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
