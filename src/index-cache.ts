import { normalizePath } from 'obsidian'
import type LeanSearchPlugin from './main'
import type { DocMeta } from './globals'
import { logVerbose } from './utils'

const CACHE_VERSION = 1
const SAVE_DELAY = 3_000
const CACHE_FILENAME = 'search-index-cache.json'
const TEMP_FILENAME = 'search-index-cache.tmp'

type CacheHeader = {
  version: number
  signature: string
  metas: DocMeta[]
}

export class IndexCache {
  private dirty = false
  private paused = false
  private stopped = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private idleSave: number | undefined
  private saving: Promise<void> | undefined

  constructor(private plugin: LeanSearchPlugin) {}

  private path(filename: string): string | undefined {
    const dir = this.plugin.manifest.dir
    return dir ? normalizePath(`${dir}/${filename}`) : undefined
  }

  private signature(): string {
    const s = this.plugin.settings
    return JSON.stringify({
      version: CACHE_VERSION,
      pluginVersion: this.plugin.manifest.version,
      indexBody: s.indexBody,
      ignoreDiacritics: s.ignoreDiacritics,
      splitCompoundWords: s.splitCompoundWords,
      extraExtensions: [...s.extraExtensions].sort(),
    })
  }

  async restore(): Promise<boolean> {
    const path = this.path(CACHE_FILENAME)
    if (!path || !(await this.plugin.app.vault.adapter.exists(path))) {
      return false
    }

    const started = performance.now()
    try {
      const payload = await this.plugin.app.vault.adapter.read(path)
      const separator = payload.indexOf('\n')
      if (separator < 0) return false

      const header = JSON.parse(payload.slice(0, separator)) as CacheHeader
      if (
        header.version !== CACHE_VERSION ||
        header.signature !== this.signature() ||
        !Array.isArray(header.metas)
      ) {
        return false
      }

      await this.plugin.searchEngine.loadSerialized(payload.slice(separator + 1))
      if (this.plugin.searchEngine.size !== header.metas.length) {
        throw new Error('cached index and metadata counts differ')
      }
      this.plugin.documentStore.loadJSON(header.metas)
      logVerbose(
        `Restored ${header.metas.length} cached files in ${(
          performance.now() - started
        ).toFixed(1)}ms`
      )
      return true
    } catch (error) {
      console.warn('[Lean Search] Ignoring invalid search cache', error)
      this.plugin.searchEngine.recreate()
      this.plugin.documentStore.clear()
      return false
    }
  }

  scheduleSave(): void {
    if (this.paused || this.stopped) return
    this.dirty = true
    this.cancelScheduledSave()
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      if (typeof window !== 'undefined' && window.requestIdleCallback) {
        this.idleSave = window.requestIdleCallback(
          () => {
            this.idleSave = undefined
            void this.saveNow()
          },
          { timeout: 5_000 }
        )
      } else {
        void this.saveNow()
      }
    }, SAVE_DELAY)
  }

  async saveNow(): Promise<void> {
    if (this.saving) return this.saving
    if (!this.dirty) return

    const path = this.path(CACHE_FILENAME)
    const tempPath = this.path(TEMP_FILENAME)
    if (!path || !tempPath) return

    this.dirty = false
    const started = performance.now()
    const header: CacheHeader = {
      version: CACHE_VERSION,
      signature: this.signature(),
      metas: this.plugin.documentStore.toJSON(),
    }
    const payload = `${JSON.stringify(header)}\n${this.plugin.searchEngine.serialize()}`

    this.saving = (async () => {
      try {
        const adapter = this.plugin.app.vault.adapter
        await adapter.write(tempPath, payload)
        if (await adapter.exists(path)) await adapter.remove(path)
        await adapter.rename(tempPath, path)
        logVerbose(
          `Saved ${(payload.length / 1_048_576).toFixed(1)}MB search cache in ${(
            performance.now() - started
          ).toFixed(1)}ms`
        )
      } catch (error) {
        this.dirty = true
        console.warn('[Lean Search] Could not save search cache', error)
      } finally {
        this.saving = undefined
        if (this.dirty && !this.stopped) this.scheduleSave()
      }
    })()
    return this.saving
  }

  beginRebuild(): void {
    this.paused = true
    this.dirty = false
    this.cancelScheduledSave()
  }

  finishRebuild(): void {
    this.paused = false
    this.scheduleSave()
  }

  stop(): void {
    this.stopped = true
    this.cancelScheduledSave()
  }

  private cancelScheduledSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    if (
      this.idleSave !== undefined &&
      typeof window !== 'undefined' &&
      window.cancelIdleCallback
    ) {
      window.cancelIdleCallback(this.idleSave)
    }
    this.idleSave = undefined
  }
}
