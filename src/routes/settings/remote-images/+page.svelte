<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<section aria-labelledby="remote-images-heading">
  <h2 id="remote-images-heading">Remote images</h2>
  <p class="help">
    Images from these senders load when you open a message. Add a sender from the arrow beside Load
    remote images in a message.
  </p>
  <div class="sync-list">
    {#each data.remoteImageRules as rule (rule.kind + rule.value)}
      <form method="POST" action="?/removeRemoteImageRule" use:enhance class="sync-card">
        <input type="hidden" name="kind" value={rule.kind} />
        <input type="hidden" name="value" value={rule.value} />
        <div>
          <strong>{rule.value}</strong>
          <p>{rule.kind === 'address' ? 'Email address' : 'Domain'}</p>
        </div>
        <button type="submit" class="remove">Remove</button>
      </form>
    {:else}<p class="help">No senders are saved.</p>{/each}
  </div>
</section>
