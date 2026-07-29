import { TFile } from 'obsidian'
import type LeanSearchPlugin from './main'
import { IndexingStep, indexingStep } from './globals'
import { getExtension, logVerbose } from './utils'

type IdleDeadline = { timeRemaining: () => number; didTimeout: boolean }
const scheduleIdle: (cb: (d: IdleDeadline) => void) => void =
  typeof (window as any).requestIdleCallback === 'function'
    ? cb => (window as any).requestIdleCallback(cb, { timeout: 1000 })
    : cb =>
        window.setTimeout(
          () => cb({ timeRemaining: () => 8, didTimeout: false }),
          30
        )

const META_CHUNK = 400
const BODY_BATCH = 20

/**
 * Keeps the index in sync with the vault without ever blocking the UI.
 *
 * - Metadata (titles/headings/tags/aliases) is indexed instantly in chunks,
 *   so search is usable the moment the plugin loads.
 * - Body text is read and indexed in the background during idle time, so a
 *   large vault never freezes Obsidian.
 * - A restored on-disk index is usable before changed files are reconciled.
 */
export class Indexer {
  private bodyQueue: string[] = []
  /** Bumped on every rebuild so stale background work cancels itself. */
  private generation = 0

  constructor(private plugin: LeanSearchPlugin) {}

  isIndexable(file: TFile): boolean {
    const ext = getExtension(file.path).toLowerCase()
    return ext === 'md' || this.plugin.settings.extraExtensions.includes(ext)
  }

  stop(): void {
    this.generation++
    this.bodyQueue = []
  }

  /** Full (re)build: instant metadata, then background body. */
  async buildAll(): Promise<void> {
    const gen = ++this.generation
    this.bodyQueue = []
    this.plugin.indexCache.beginRebuild()
    this.plugin.searchEngine.clear()
    this.plugin.documentStore.clear()

    const files = this.plugin.app.vault
      .getFiles()
      .filter(f => this.isIndexable(f))
    logVerbose(`Indexing ${files.length} files`)

    indexingStep.set(IndexingStep.ReadingMetadata)
    for (let i = 0; i < files.length; i += META_CHUNK) {
      if (gen !== this.generation) return
      for (const file of files.slice(i, i + META_CHUNK)) {
        const meta = this.plugin.documentStore.buildMeta(file)
        this.plugin.documentStore.set(meta)
        this.plugin.searchEngine.addOrReplace(
          this.plugin.documentStore.toIndexDoc(meta)
        )
      }
      await new Promise(r => setTimeout(r, 0)) // let the UI breathe
    }

    if (gen !== this.generation) return

    if (this.plugin.settings.indexBody) {
      this.bodyQueue = files.map(f => f.path)
      indexingStep.set(IndexingStep.IndexingBody)
      this.pumpBody(gen)
    } else {
      indexingStep.set(IndexingStep.Done)
      this.plugin.indexCache.finishRebuild()
    }
  }

  private pumpBody(gen: number): void {
    scheduleIdle(async () => {
      if (gen !== this.generation) return
      const batch = this.bodyQueue.splice(0, BODY_BATCH)
      if (!batch.length) {
        indexingStep.set(IndexingStep.Done)
        logVerbose('Body indexing complete')
        this.plugin.indexCache.finishRebuild()
        return
      }
      for (const path of batch) {
        const meta = this.plugin.documentStore.get(path)
        if (!meta) continue
        const content = await this.plugin.documentStore.readContent(path)
        if (gen !== this.generation) return
        this.plugin.searchEngine.addOrReplace(
          this.plugin.documentStore.toIndexDoc(meta, content)
        )
      }
      this.pumpBody(gen)
    })
  }

  // --- Live, incremental updates --------------------------------------------

  /** Make a restored index current without delaying its availability. */
  async reconcileCached(): Promise<void> {
    const gen = ++this.generation
    this.bodyQueue = []
    indexingStep.set(IndexingStep.RefreshingCache)

    const files = this.plugin.app.vault
      .getFiles()
      .filter(file => this.isIndexable(file))
    const current = new Map(files.map(file => [file.path, file]))
    let changed = false

    for (const path of this.plugin.documentStore.paths()) {
      if (!current.has(path)) {
        this.removeFile(path)
        changed = true
      }
    }

    const stale = files.filter(file => {
      const cached = this.plugin.documentStore.get(file.path)
      return !cached || cached.mtime !== file.stat.mtime
    })

    for (let i = 0; i < stale.length; i += BODY_BATCH) {
      if (gen !== this.generation) return
      await Promise.all(
        stale.slice(i, i + BODY_BATCH).map(file => this.indexFile(file))
      )
      changed = true
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    if (gen !== this.generation) return
    indexingStep.set(IndexingStep.Done)
    if (changed) this.plugin.indexCache.scheduleSave()
    logVerbose(`Refreshed ${stale.length} changed cached files`)
  }

  async indexFile(file: TFile): Promise<void> {
    if (!this.isIndexable(file)) return
    const meta = this.plugin.documentStore.buildMeta(file)
    this.plugin.documentStore.set(meta)
    const content = this.plugin.settings.indexBody
      ? await this.plugin.documentStore.readContent(file.path)
      : ''
    this.plugin.searchEngine.addOrReplace(
      this.plugin.documentStore.toIndexDoc(meta, content)
    )
    this.plugin.indexCache.scheduleSave()
  }

  removeFile(path: string): void {
    this.plugin.searchEngine.remove(path)
    this.plugin.documentStore.delete(path)
    this.plugin.frecency.remove(path)
    this.plugin.indexCache.scheduleSave()
  }

  async renameFile(oldPath: string, file: TFile): Promise<void> {
    this.plugin.searchEngine.remove(oldPath)
    this.plugin.documentStore.delete(oldPath)
    this.plugin.frecency.rename(oldPath, file.path)
    await this.indexFile(file)
  }
}
