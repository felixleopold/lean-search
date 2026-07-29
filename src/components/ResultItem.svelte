<script lang="ts">
  import { setIcon } from 'obsidian'
  import type { ResultNote } from '../globals'
  import type LeanSearchPlugin from '../main'
  import { getExtension, pathWithoutFilename } from '../utils'
  import ResultItemContainer from './ResultItemContainer.svelte'

  export let plugin: LeanSearchPlugin
  export let note: ResultNote
  export let selected = false

  let elFileIcon: HTMLElement | null = null
  let elRecentIcon: HTMLElement | null = null

  function iconFor(path: string): string {
    const ext = getExtension(path).toLowerCase()
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext))
      return 'image'
    if (ext === 'pdf') return 'file-text'
    if (ext === 'canvas') return 'layout-dashboard'
    return 'file-text'
  }

  const fmt = (n: number): string =>
    n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)

  $: title = note.displayTitle || note.basename
  $: notePath = pathWithoutFilename(note.path)
  $: matchesTitle = plugin.textProcessor.getMatches(title, note.foundWords)
  $: matchesPath = plugin.textProcessor.getMatches(notePath, note.foundWords)
  $: excerpt = plugin.settings.showExcerpt
    ? plugin.textProcessor.makeExcerpt(note.content, note.matches[0]?.offset ?? -1)
    : ''
  $: if (elFileIcon) setIcon(elFileIcon, iconFor(note.path))
  $: if (elRecentIcon) setIcon(elRecentIcon, 'history')
</script>

<ResultItemContainer
  id={note.path}
  {selected}
  on:click
  on:auxclick
  on:mousemove>
  <div class="lean-search-result__row">
    <span bind:this={elFileIcon} class="lean-search-result__icon"></span>

    <div class="lean-search-result__main">
      <div class="lean-search-result__title-line">
        <span class="lean-search-result__title">
          {@html plugin.textProcessor.highlightText(title, matchesTitle)}
        </span>
        {#if !note.displayTitle && getExtension(note.path) !== 'md'}
          <span class="lean-search-result__ext">.{getExtension(note.path)}</span>
        {/if}
        {#if note.frecency > 0}
          <span
            bind:this={elRecentIcon}
            class="lean-search-result__recent"
            title="Recently / often opened — boosted"></span>
        {/if}
        {#if notePath}
          <span class="lean-search-result__sep">·</span>
          <span class="lean-search-result__path">
            {@html plugin.textProcessor.highlightText(notePath, matchesPath)}
          </span>
        {/if}
        {#if note.matches.length > 0}
          <span class="lean-search-result__counter">
            {note.matches.length}
            {note.matches.length > 1 ? 'matches' : 'match'}
          </span>
        {/if}
      </div>

      {#if excerpt}
        <div class="lean-search-result__body">
          {@html plugin.textProcessor.highlightText(excerpt, note.matches)}
        </div>
      {/if}

      {#if note.debug}
        <div class="lean-search-result__debug">
          <span>match {fmt(note.debug.base)}</span>
          <span>× field {fmt(note.debug.fieldBonus)}</span>
          <span>× recency {fmt(note.debug.frecencyMult)} (f={fmt(note.debug.frecency)})</span>
          <span>× edit {fmt(note.debug.modifiedMult)}</span>
          <span class="lean-search-result__debug-final">= {fmt(note.debug.final)}</span>
          {#if note.debug.terms.length}
            <span class="lean-search-result__debug-terms"
              >[{note.debug.terms.join(' ')}]</span>
          {/if}
        </div>
      {/if}
    </div>

    {#if note.imageSrc}
      <img
        class="lean-search-result__thumb"
        src={note.imageSrc}
        alt=""
        loading="lazy" />
    {/if}
  </div>
</ResultItemContainer>
