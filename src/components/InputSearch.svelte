<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte'
  import { Platform, setIcon } from 'obsidian'
  import { toggleInputComposition } from '../globals'
  import { debounce, wait } from '../utils'
  import type LeanSearchPlugin from '../main'

  export let initialValue = ''
  export let placeholder = ''
  export let plugin: LeanSearchPlugin

  let value = ''
  let initialSet = false
  let elInput: HTMLInputElement
  const dispatch = createEventDispatcher()

  export function setInputValue(v: string): void {
    value = v
    dispatch('input', value)
  }

  function mountIcon(node: HTMLElement, icon: string): void {
    setIcon(node, icon)
  }

  function clearInput(): void {
    setInputValue('')
    elInput.focus()
  }

  $: watchInitialValue(initialValue)
  function watchInitialValue(v: string): void {
    if (v && !initialSet && !value) {
      initialSet = true
      value = v
      selectInput()
    }
  }

  // Doubles as a Svelte action (`use:selectInput`), so it must accept the node arg.
  function selectInput(_node?: HTMLElement): void {
    tick()
      .then(async () => {
        if (Platform.isMobileApp) await wait(200)
        elInput?.focus()
        return tick()
      })
      .then(async () => {
        if (Platform.isMobileApp) await wait(200)
        elInput?.select()
      })
  }

  const debouncedInput = debounce(() => {
    // Typing without running marks the next open as "start empty".
    plugin.searchHistory.add('')
    dispatch('input', value)
  }, 60)
</script>

<div class="lean-search-input-container">
  <div class="lean-search-input-field">
    <span
      class="lean-search-input__icon"
      aria-hidden="true"
      use:mountIcon={'search'}></span>
    <input
      bind:this={elInput}
      bind:value
      class="prompt-input"
      type="text"
      aria-label={placeholder}
      autocomplete="off"
      spellcheck="false"
      {placeholder}
      on:input={debouncedInput}
      on:compositionstart={() => toggleInputComposition(true)}
      on:compositionend={() => toggleInputComposition(false)}
      use:selectInput />
    {#if value}
      <button
        class="clickable-icon lean-search-input__clear"
        type="button"
        aria-label="Clear search"
        title="Clear search"
        on:click={clearInput}>
        <span aria-hidden="true" use:mountIcon={'x'}></span>
      </button>
    {/if}
  </div>
  <slot />
</div>
