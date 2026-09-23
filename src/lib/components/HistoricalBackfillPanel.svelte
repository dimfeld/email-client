<script lang="ts">
  import { enhance } from '$app/forms';
  import type { HistoricalBackfill } from '$lib/server/historical-backfill';
  let {
    accounts,
    jobs,
    delayMs,
  }: {
    accounts: { email: string; connected: boolean; enabled: boolean }[];
    jobs: HistoricalBackfill[];
    delayMs: number;
  } = $props();
  let submitting = $state(false);
</script>

<section aria-labelledby="history-heading">
  <h2 id="history-heading">Historical email import</h2>
  <p>
    Download older mail in the background. Leave the query and dates empty to import all mail before
    this task starts. You can close this page. The task resumes after a server restart.
  </p>
  <form
    method="POST"
    action="?/startHistory"
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        await update({ reset: false });
        submitting = false;
      };
    }}
  >
    <label for="history-account">Account</label><select id="history-account" name="account" required
      ><option value="">Choose an account</option
      >{#each accounts.filter((account) => account.connected && account.enabled) as account}<option
          value={account.email}>{account.email}</option
        >{/each}</select
    >
    <label for="history-query">Gmail query (optional)</label><input
      id="history-query"
      name="query"
      placeholder="from:example.com"
    />
    <div class="dates">
      <div>
        <label for="history-after">Start date (UTC)</label><input
          id="history-after"
          name="after"
          type="date"
        />
      </div>
      <div>
        <label for="history-before">Before date (UTC, excluded)</label><input
          id="history-before"
          name="before"
          type="date"
        />
      </div>
    </div>
    <label for="history-delay">Delay between requests (seconds)</label><input
      id="history-delay"
      name="delaySeconds"
      type="number"
      step="any"
      value={delayMs / 1000}
      required
    />
    <p class="help">
      The initial delay matches Google data sync. Increase it for a slower import. Rate-limit
      responses add an automatic wait.
    </p>
    <label class="checkbox"
      ><input type="checkbox" name="classify" /> Classify imported messages with Jev</label
    >
    <p class="help">
      Classification sends imported email to Jev and uses your API account. Without it, messages
      remain searchable and can be classified later.
    </p>
    <button type="submit" disabled={submitting}
      >{submitting ? 'Starting…' : 'Start historical import'}</button
    >
  </form>
  <div class="jobs" aria-label="Import tasks">
    {#each jobs as job (job.id)}
      <article>
        <header><strong>{job.accountEmail}</strong><span>{job.status}</span></header>
        <code>{job.query}</code>
        <p>
          {job.downloaded} downloaded · {job.missing} no longer available · {job.processed} processed
        </p>
        <p class="help">
          {job.classify ? 'Jev classification enabled' : 'Download only'} · Updated {new Date(
            job.updatedAt
          ).toLocaleString()}
        </p>
        {#if job.error}<p class="error">{job.error}</p>{/if}
        {#if job.retryCount && (job.status === 'queued' || job.status === 'running')}<p>
            Next attempt: {new Date(job.nextRunAt).toLocaleString()}
          </p>{/if}
        {#if job.status !== 'complete'}<form method="POST" action="?/pauseHistory" use:enhance>
            <input type="hidden" name="id" value={job.id} /><input
              type="hidden"
              name="paused"
              value={job.status === 'paused' || job.status === 'failed' ? 'no' : 'yes'}
            /><button type="submit"
              >{job.status === 'paused' || job.status === 'failed'
                ? 'Resume import'
                : 'Pause import'}</button
            >
          </form>{/if}
      </article>
    {:else}<p class="help">No historical imports yet.</p>{/each}
  </div>
</section>

<style>
  h2 {
    font-size: 1.3rem;
    margin: 0 0 12px;
  }
  p {
    color: var(--color-text-muted);
    line-height: 1.6;
    margin: 8px 0;
    font-size: 0.85rem;
  }
  form {
    margin-top: 18px;
  }
  label {
    display: block;
    color: var(--color-text-secondary);
    font-size: 0.85rem;
    margin: 14px 0 8px;
  }
  input,
  select {
    width: 100%;
    box-sizing: border-box;
    padding: 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    color: var(--color-text);
    background: var(--color-surface);
    font: inherit;
  }
  .dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .help {
    font-size: 0.75rem;
  }
  .checkbox {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .checkbox input {
    width: auto;
  }
  button {
    padding: 10px 16px;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--color-bg);
    background: var(--color-accent);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
  .jobs {
    margin-top: 24px;
    display: grid;
    gap: 12px;
  }
  article {
    padding: 16px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  header span {
    color: var(--color-accent);
    text-transform: capitalize;
  }
  code {
    display: block;
    margin-top: 12px;
    color: var(--color-text-muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.75rem;
  }
  .error {
    color: var(--color-danger);
  }
  @media (max-width: 560px) {
    .dates {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
</style>
