import { getAllTags, parseFrontMatterAliases, TFile } from 'obsidian'
import type LeanSearchPlugin from './main'
import type { DocMeta, IndexDoc } from './globals'
import { pathWithoutFilename } from './utils'

/**
 * Holds lightweight per-note metadata in memory (titles, headings, tags,
 * aliases) — but NEVER the body text. Body lives only in the MiniSearch
 * inverted index; full content for excerpts is re-read on demand for the
 * handful of results actually displayed. This is the single biggest memory
 * win over OmniSearch, which kept a second full copy of every note.
 */
export class DocumentStore {
  private metas = new Map<string, DocMeta>()

  constructor(private plugin: LeanSearchPlugin) {}

  buildMeta(file: TFile): DocMeta {
    const cache = this.plugin.app.metadataCache.getFileCache(file)
    const headings = cache?.headings?.map(h => h.heading) ?? []
    const tags = (cache ? getAllTags(cache) ?? [] : []).map(t =>
      t.replace(/^#/, '')
    )
    const aliases = parseFrontMatterAliases(cache?.frontmatter ?? null) ?? []
    const fm = cache?.frontmatter ?? {}
    const fmTitle = fm.title
    const image = [fm.image, fm.cover, fm.banner, fm.thumbnail].find(
      v => typeof v === 'string' && v.trim()
    )
    return {
      path: file.path,
      basename: file.basename,
      displayTitle: typeof fmTitle === 'string' ? fmTitle : '',
      aliases,
      tags,
      headings,
      mtime: file.stat.mtime,
      image: typeof image === 'string' ? image : '',
    }
  }

  toIndexDoc(meta: DocMeta, body = ''): IndexDoc {
    return {
      path: meta.path,
      basename: meta.displayTitle
        ? `${meta.basename} ${meta.displayTitle}`
        : meta.basename,
      aliases: meta.aliases.join(' '),
      headings: meta.headings.join(' \n '),
      tags: meta.tags.join(' '),
      directory: pathWithoutFilename(meta.path),
      body,
    }
  }

  set(meta: DocMeta): void {
    this.metas.set(meta.path, meta)
  }
  get(path: string): DocMeta | undefined {
    return this.metas.get(path)
  }
  has(path: string): boolean {
    return this.metas.has(path)
  }
  delete(path: string): void {
    this.metas.delete(path)
  }
  rename(oldPath: string, meta: DocMeta): void {
    this.metas.delete(oldPath)
    this.metas.set(meta.path, meta)
  }
  clear(): void {
    this.metas.clear()
  }
  paths(): string[] {
    return [...this.metas.keys()]
  }
  toJSON(): DocMeta[] {
    return [...this.metas.values()]
  }
  loadJSON(metas: DocMeta[]): void {
    this.metas = new Map(metas.map(meta => [meta.path, meta]))
  }
  get size(): number {
    return this.metas.size
  }

  async readContent(path: string): Promise<string> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return ''
    try {
      return await this.plugin.app.vault.cachedRead(file)
    } catch {
      return ''
    }
  }
}
