import { Plugin, TFile } from 'obsidian'
import {
  DEFAULT_SETTINGS,
  type LeanSearchSettings,
  LeanSearchSettingTab,
} from './settings'
import { DocumentStore } from './document-store'
import { SearchEngine } from './search/search-engine'
import { Indexer } from './indexer'
import { Frecency } from './search/frecency'
import { TextProcessor } from './text'
import { SearchHistory } from './search-history'
import { IndexCache } from './index-cache'
import { IndexingStep, indexingStep } from './globals'
import {
  LeanSearchInFileModal,
  LeanSearchVaultModal,
} from './components/modals'
import { debounce, setVerbose } from './utils'

type PersistedData = {
  settings?: Partial<LeanSearchSettings>
  frecency?: Record<string, [number, number]>
  history?: string[]
}

export default class LeanSearchPlugin extends Plugin {
  settings: LeanSearchSettings = { ...DEFAULT_SETTINGS }

  readonly documentStore = new DocumentStore(this)
  readonly frecency = new Frecency()
  readonly searchEngine = new SearchEngine(this)
  readonly indexCache = new IndexCache(this)
  readonly indexer = new Indexer(this)
  readonly textProcessor = new TextProcessor(this)
  readonly searchHistory = new SearchHistory(this)

  private ribbonEl?: HTMLElement
  private persistDebounced = debounce(() => void this.persistNow(), 800)

  async onload(): Promise<void> {
    await this.loadPersisted()
    // SearchEngine is constructed before persisted settings are available.
    this.searchEngine.recreate()
    this.frecency.onChange = () => this.persist()
    this.addSettingTab(new LeanSearchSettingTab(this.app, this))

    this.addCommand({
      id: 'open-search',
      name: 'Search vault',
      callback: () => new LeanSearchVaultModal(this).open(),
    })
    this.addCommand({
      id: 'open-in-file-search',
      name: 'Search in current file',
      editorCallback: (_editor, view) => {
        if (view.file) new LeanSearchInFileModal(this, view.file).open()
      },
    })

    if (this.settings.ribbonIcon) this.addRibbon()

    // Frecency: every time a note is opened, it gets more likely to win.
    this.registerEvent(
      this.app.workspace.on('file-open', file => {
        if (file instanceof TFile && this.indexer.isIndexable(file)) {
          this.frecency.record(file.path)
        }
      })
    )

    this.app.workspace.onLayoutReady(() => void this.initializeSearchIndex())
  }

  onunload(): void {
    this.indexer.stop()
    this.indexCache.stop()
    void this.indexCache.saveNow()
    void this.persistNow()
  }

  private async initializeSearchIndex(): Promise<void> {
    indexingStep.set(IndexingStep.LoadingCache)
    const restored = await this.indexCache.restore()
    this.registerVaultEvents()
    if (restored) void this.indexer.reconcileCached()
    else void this.indexer.buildAll()
  }

  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on('create', f => {
        if (f instanceof TFile) void this.indexer.indexFile(f)
      })
    )
    // Non-markdown bodies (txt, etc.) — markdown is handled via metadata 'changed'.
    this.registerEvent(
      this.app.vault.on('modify', f => {
        if (f instanceof TFile && f.extension !== 'md') {
          void this.indexer.indexFile(f)
        }
      })
    )
    this.registerEvent(
      this.app.vault.on('delete', f => {
        if (f instanceof TFile) this.indexer.removeFile(f.path)
      })
    )
    this.registerEvent(
      this.app.vault.on('rename', (f, oldPath) => {
        if (f instanceof TFile) void this.indexer.renameFile(oldPath, f)
      })
    )
    // Fires after Obsidian re-parses a markdown file (updated headings/tags).
    this.registerEvent(
      this.app.metadataCache.on('changed', f => {
        if (f instanceof TFile && this.indexer.isIndexable(f)) {
          void this.indexer.indexFile(f)
        }
      })
    )
  }

  // --- Persistence (settings + frecency + history in one tiny data file) ----

  private async loadPersisted(): Promise<void> {
    const data = (await this.loadData()) as PersistedData | null
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings)
    this.frecency.loadJSON(data?.frecency)
    this.searchHistory.load(data?.history)
    setVerbose(this.settings.verboseLogging)
  }

  private buildData(): PersistedData {
    return {
      settings: this.settings,
      frecency: this.frecency.toJSON(),
      history: this.searchHistory.toJSON(),
    }
  }

  persist(): void {
    this.persistDebounced()
  }
  async persistNow(): Promise<void> {
    await this.saveData(this.buildData())
  }
  async saveSettings(): Promise<void> {
    await this.persistNow()
  }

  /** Recreate the empty index (e.g. after a tokenizer/diacritics change). */
  rebuildIndex(): void {
    this.searchEngine.recreate()
    void this.indexer.buildAll()
  }

  private addRibbon(): void {
    this.ribbonEl = this.addRibbonIcon('search', 'Lean Search', () =>
      new LeanSearchVaultModal(this).open()
    )
  }

  refreshRibbon(): void {
    if (this.settings.ribbonIcon && !this.ribbonEl) {
      this.addRibbon()
    } else if (!this.settings.ribbonIcon && this.ribbonEl) {
      this.ribbonEl.remove()
      this.ribbonEl = undefined
    }
  }
}
