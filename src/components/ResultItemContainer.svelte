<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let id: string
  export let selected = false
  export let cssClass = ''

  const dispatch = createEventDispatcher()
</script>

<!-- Keyboard navigation is handled by the modal scope (arrows + Enter), not per row. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="suggestion-item lean-search-result {cssClass} {selected
    ? 'is-selected'
    : ''}"
  data-result-id={id}
  role="option"
  aria-selected={selected}
  tabindex="-1"
  on:click={e => dispatch('click', e)}
  on:auxclick={e => dispatch('auxclick', e)}
  on:mousemove={e => dispatch('mousemove', e)}>
  <slot />
</div>
