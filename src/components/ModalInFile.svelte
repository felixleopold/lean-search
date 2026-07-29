<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import type { TFile } from 'obsidian'
  import { eventBus } from '../event-bus'
  import { Action, type ResultNote, type SearchMatch } from '../globals'
  import { Query } from '../search/query'
  import { openNote } from '../notes'
  import { debounce, loopIndex } from '../utils'
  import InputSearch from './InputSearch.svelte'
  import ModalContainer from './ModalContainer.svelte'
  import ResultItemContainer from './ResultItemContainer.svelte'
  import type { LeanSearchInFileModal } from './modals'
  import type LeanSearchPlugin from '../main'

  let {
    plugin,
    modal,
    file,
    previousQuery = '',
  }: {
    plugin: LeanSearchPlugin
    modal: LeanSearchInFileModal
    file: TFile
    previousQuery?: string
  } = $props()

  let searchQuery = $state(untrack(() => previousQuery) ?? '')
  let content = $state('')
  let matches: SearchMatch[] = $state([])
  let selectedIndex = $state(0)
  let refInput: InputSearch | undefined

  const words = $derived(new Query(searchQuery).foundWords())

  function update(): void {
    const q = new Query(searchQuery)
    matches = q.isEmpty()
      ? []
      : plugin.textProcessor.getMatches(content, q.foundWords())
    selectedIndex = 0
  }
  const updateDebounced = debounce(update, 0)

  $effect(() => {
    void searchQuery
    void content
    updateDebounced()
  })

  onMount(async () => {
    eventBus.enable('infile')
    eventBus.on('infile', Action.Enter, openSelected)
    eventBus.on('infile', Action.OpenInNewPane, () => openSelected(true))
    eventBus.on('infile', Action.ArrowUp, () => move(-1))
    eventBus.on('infile', Action.ArrowDown, () => move(1))
    content = await plugin.documentStore.readContent(file.path)
  })
  onDestroy(() => eventBus.disable('infile'))

  function asNote(): ResultNote {
    return {
      path: file.path,
      basename: file.basename,
      displayTitle: '',
      score: 0,
      frecency: 0,
      mtime: file.stat.mtime,
      content,
      foundWords: words,
      matches,
    }
  }

  function openSelected(newPane = false): void {
    const m = matches[selectedIndex]
    if (!m) return
    void openNote(plugin, asNote(), m.offset, newPane)
    modal.close()
  }

  function move(dir: 1 | -1): void {
    selectedIndex = loopIndex(selectedIndex + dir, matches.length)
    void scrollIntoView()
  }

  function onClick(i: number): void {
    selectedIndex = i
    openSelected()
  }

  function excerpt(m: SearchMatch): string {
    return plugin.textProcessor.makeExcerpt(content, m.offset)
  }

  async function scrollIntoView(): Promise<void> {
    await tick()
    const el = modal.modalEl.querySelector(`[data-result-id="match-${selectedIndex}"]`)
    el?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }
</script>

<InputSearch
  bind:this={refInput}
  {plugin}
  initialValue={searchQuery}
  on:input={e => (searchQuery = e.detail)}
  placeholder="Search in {file.basename}" />

<ModalContainer>
  {#each matches as m, i (i)}
    <ResultItemContainer
      id={`match-${i}`}
      selected={i === selectedIndex}
      on:click={() => onClick(i)}
      on:mousemove={() => (selectedIndex = i)}>
      <div class="lean-search-result__body">
        {@html plugin.textProcessor.highlightText(
          excerpt(m),
          words.map(w => ({ match: w, offset: 0 }))
        )}
      </div>
    </ResultItemContainer>
  {/each}

  <div class="lean-search-empty">
    {#if searchQuery && !matches.length}
      No matches in this file.
    {:else if !searchQuery}
      Type to search within “{file.basename}”.
    {/if}
  </div>
</ModalContainer>

<div class="prompt-instructions">
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">↑↓</span><span>navigate</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">↵</span><span>go to match</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">Esc</span><span>close</span>
  </div>
</div>
