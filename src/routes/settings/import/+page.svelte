<script lang="ts">
  import HistoricalBackfillPanel from '$lib/components/HistoricalBackfillPanel.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<HistoricalBackfillPanel
  accounts={data.accounts}
  jobs={data.historicalBackfills}
  delayMs={data.historicalDelayMs}
/>
