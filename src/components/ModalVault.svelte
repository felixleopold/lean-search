<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { MarkdownView, Notice, Platform, TFile } from 'obsidian'
  import { eventBus } from '../event-bus'
  import {
    Action,
    indexingStep,
    IndexingStep,
    type ResultNote,
  } from '../globals'
  import { Query } from '../search/query'
  import { openNote, createNote } from '../notes'
  import {
    debounce,
    getAltKeyLabel,
    getCtrlKeyLabel,
    getExtension,
    loopIndex,
  } from '../utils'
  import InputSearch from './InputSearch.svelte'
  import ModalContainer from './ModalContainer.svelte'
  import ResultItem from './ResultItem.svelte'
  import { LeanSearchInFileModal, type LeanSearchVaultModal } from './modals'
  import type LeanSearchPlugin from '../main'

  let {
    plugin,
    modal,
    previousQuery = '',
  }: {
    plugin: LeanSearchPlugin
    modal: LeanSearchVaultModal
    previousQuery?: string
  } = $props()

  let searchQuery = $state(untrack(() => previousQuery) ?? '')
  let resultNotes: ResultNote[] = $state([])
  let selectedIndex = $state(0)
  let searching = $state(false)
  let indexDesc = $state('')
  let step = $state<IndexingStep>(IndexingStep.Idle)
  let historyIndex = -1
  let refInput: InputSearch | undefined

  const selectedNote = $derived(resultNotes[selectedIndex])

  const ctrl = getCtrlKeyLabel()
  const alt = getAltKeyLabel()
  const openCurrentKey = $derived(plugin.settings.openInNewPane ? `${ctrl} ↵` : '↵')
  const openNewPaneKey = $derived(plugin.settings.openInNewPane ? '↵' : `${ctrl} ↵`)

  let reqId = 0
  let disposed = false
  let searchController: AbortController | undefined
  let searchingTimer: number | undefined
  async function updateResults(): Promise<void> {
    if (disposed) return
    searchController?.abort()
    const controller = new AbortController()
    searchController = controller
    const id = ++reqId
    // Only flash "Searching…" if results take a noticeable moment to arrive.
    // The in-memory index resolves instantly (recents especially), so this
    // avoids the distracting flicker on open and on every keystroke.
    window.clearTimeout(searchingTimer)
    searchingTimer = window.setTimeout(() => {
      if (id === reqId) searching = true
    }, 120)
    const query = new Query(searchQuery)
    const notes = await plugin.searchEngine.getSuggestions(query, partial => {
      if (id !== reqId) return
      window.clearTimeout(searchingTimer)
      searching = false
      resultNotes = partial
      selectedIndex = 0
    }, controller.signal)
    if (id !== reqId) return // a newer query superseded this one
    window.clearTimeout(searchingTimer)
    searching = false
    const selectedPath = selectedNote?.path
    resultNotes = notes
    selectedIndex = Math.max(0, notes.findIndex(note => note.path === selectedPath))
    await scrollIntoView()
  }
  const updateDebounced = debounce(() => void updateResults(), 0)

  $effect(() => {
    // Re-search whenever the query changes.
    void searchQuery
    updateDebounced()
    return () => {
      searchController?.abort()
      reqId++
      window.clearTimeout(searchingTimer)
    }
  })

  $effect(() => {
    switch (step) {
      case IndexingStep.LoadingCache:
        indexDesc = 'Loading cached search index…'
        break
      case IndexingStep.RefreshingCache:
        indexDesc = 'Refreshing changed notes in the background…'
        break
      case IndexingStep.ReadingMetadata:
        indexDesc = 'Indexing titles & headings…'
        break
      case IndexingStep.IndexingBody:
        indexDesc = 'Indexing note contents in the background…'
        // Refresh results as more content becomes searchable.
        updateDebounced()
        break
      default:
        indexDesc = ''
        updateDebounced()
    }
  })

  onMount(() => {
    eventBus.enable('vault')
    eventBus.on('vault', Action.Enter, openAndClose)
    eventBus.on('vault', Action.OpenInBackground, openInBackground)
    eventBus.on('vault', Action.OpenInNewPane, openInNewPane)
    eventBus.on('vault', Action.OpenInNewLeaf, openInNewLeaf)
    eventBus.on('vault', Action.InsertLink, insertLink)
    eventBus.on('vault', Action.CreateNote, createAndClose)
    eventBus.on('vault', Action.Tab, switchToInFile)
    eventBus.on('vault', Action.ArrowUp, () => moveIndex(-1))
    eventBus.on('vault', Action.ArrowDown, () => moveIndex(1))
    eventBus.on('vault', Action.PrevSearchHistory, prevHistory)
    eventBus.on('vault', Action.NextSearchHistory, nextHistory)
    return indexingStep.subscribe(v => (step = v))
  })
  onDestroy(() => {
    disposed = true
    searchController?.abort()
    reqId++
    window.clearTimeout(searchingTimer)
    eventBus.disable('vault')
  })

  function saveQuery(): void {
    if (searchQuery) plugin.searchHistory.add(searchQuery)
  }

  function openResult(note: ResultNote, newPane = false, newLeaf = false): void {
    saveQuery()
    const offset = note.matches?.[0]?.offset ?? 0
    void openNote(plugin, note, offset, newPane, newLeaf)
  }

  function openAndClose(): void {
    if (!selectedNote) return
    openResult(selectedNote)
    modal.close()
  }
  function openInBackground(): void {
    if (selectedNote) openResult(selectedNote, true)
  }
  function openInNewPane(): void {
    if (!selectedNote) return
    openResult(selectedNote, true)
    modal.close()
  }
  function openInNewLeaf(): void {
    if (!selectedNote) return
    openResult(selectedNote, true, true)
    modal.close()
  }

  function onClick(evt?: MouseEvent): void {
    if (!selectedNote) return
    if (evt?.ctrlKey || evt?.metaKey) openResult(selectedNote, true)
    else openResult(selectedNote)
    modal.close()
  }

  async function createAndClose(opt?: { newLeaf: boolean }): Promise<void> {
    if (!searchQuery) return
    try {
      await createNote(plugin.app, searchQuery, opt?.newLeaf)
    } catch (e) {
      new Notice((e as Error).message)
      return
    }
    modal.close()
  }

  function insertLink(): void {
    if (!selectedNote) return
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView)
    if (!view?.editor) {
      new Notice('Lean Search — no active editor to insert a link')
      return
    }
    const file = plugin.app.vault.getAbstractFileByPath(selectedNote.path)
    const active = plugin.app.workspace.getActiveFile()
    let link: string
    if (file instanceof TFile && active) {
      link = plugin.app.fileManager.generateMarkdownLink(
        file,
        active.path,
        '',
        selectedNote.displayTitle || undefined
      )
    } else {
      link = `[[${selectedNote.basename}]]`
    }
    const cursor = view.editor.getCursor()
    view.editor.replaceRange(link, cursor, cursor)
    modal.close()
  }

  function switchToInFile(): void {
    saveQuery()
    const path = selectedNote?.path
    modal.close()
    if (path && getExtension(path) === 'md') {
      const file = plugin.app.vault.getAbstractFileByPath(path)
      if (file instanceof TFile) {
        new LeanSearchInFileModal(plugin, file, searchQuery).open()
        return
      }
    }
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView)
    if (view?.file) {
      new LeanSearchInFileModal(plugin, view.file, searchQuery).open()
    }
  }

  function moveIndex(dir: 1 | -1): void {
    selectedIndex = loopIndex(selectedIndex + dir, resultNotes.length)
    void scrollIntoView()
  }

  async function prevHistory(): Promise<void> {
    const h = plugin.searchHistory.get().filter(Boolean)
    if (!h.length) return
    historyIndex = (historyIndex + 1) % h.length
    searchQuery = h[historyIndex] ?? ''
    refInput?.setInputValue(searchQuery)
  }
  async function nextHistory(): Promise<void> {
    const h = plugin.searchHistory.get().filter(Boolean)
    if (!h.length) return
    historyIndex = historyIndex <= 0 ? h.length - 1 : historyIndex - 1
    searchQuery = h[historyIndex] ?? ''
    refInput?.setInputValue(searchQuery)
  }

  async function scrollIntoView(): Promise<void> {
    await tick()
    if (!selectedNote) return
    const el = modal.modalEl.querySelector(
      `[data-result-id="${CSS.escape(selectedNote.path)}"]`
    )
    el?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }
</script>

<InputSearch
  bind:this={refInput}
  {plugin}
  initialValue={searchQuery}
  on:input={e => (searchQuery = e.detail)}
  placeholder="Lean Search — type to find a note">
  {#if Platform.isMobile}
    <div class="lean-search-input__buttons">
      <button onclick={switchToInFile}>In-file</button>
    </div>
  {/if}
</InputSearch>

{#if indexDesc}
  <div class="lean-search-indexing">⏳ {indexDesc}</div>
{/if}

<ModalContainer>
  {#each resultNotes as result (result.path)}
    <ResultItem
      {plugin}
      note={result}
      selected={result.path === selectedNote?.path}
      on:mousemove={() =>
        (selectedIndex = resultNotes.findIndex(r => r.path === result.path))}
      on:click={e => onClick(e.detail)}
      on:auxclick={e => {
        if (e.detail?.button === 1) openInNewPane()
      }} />
  {/each}

  <div class="lean-search-empty">
    {#if searching && !resultNotes.length}
      Searching…
    {:else if !resultNotes.length && searchQuery}
      No results for “{searchQuery}”.
    {:else if !resultNotes.length && !searchQuery}
      Open some notes — they’ll show up here, most-recent first.
    {/if}
  </div>
</ModalContainer>

<div class="prompt-instructions">
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">↑↓</span><span>navigate</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{openCurrentKey}</span><span>open</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{openNewPaneKey}</span><span>open in new pane</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">Tab</span><span>search in file</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{alt} ↵</span><span>insert link</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{alt} ↑↓</span><span>history</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">Esc</span><span>close</span>
  </div>
</div>
