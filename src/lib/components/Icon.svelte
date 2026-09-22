<script lang="ts" module>
  // Outline icons on a 24px grid with one stroke width, so every icon matches.
  const paths = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    close: 'M6 6l12 12M18 6L6 18',
    minimize: 'M5 12h14',
    expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
    collapse: 'M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7',
    'chevron-down': 'M6 9l6 6 6-6',
    'chevron-left': 'M15 6l-6 6 6 6',
    'chevron-right': 'M9 6l6 6-6 6',
    'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
    settings:
      'M20 7h-9M14 17H5M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    today: 'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  } as const;
  export type IconName = keyof typeof paths;
</script>

<script lang="ts">
  let { name, size = '1.1em' }: { name: IconName; size?: string } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"><path d={paths[name]} /></svg
>

<style>
  .icon {
    display: block;
    flex-shrink: 0;
  }
</style>
