import MiniSearch, { type Options, type SearchResult } from 'minisearch'
import { TFile } from 'obsidian'
import type LeanSearchPlugin from '../main'
import type { DocMeta, IndexDoc, ResultNote, ScoreDebug } from '../globals'
import { Query } from './query'
import {
  makeIndexTokenizer,
  makeProcessTerm,
  makeSearchTokenizer,
} from './tokenizer'
import { logVerbose, removeDiacritics } from '../utils'

type Ranked = {
  path: string
  score: number
  frecency: number
  debug?: ScoreDebug
}

const HOUR = 3600_000
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const CONTENT_READ_CONCURRENCY = 8
const ASYNC_LOAD_THRESHOLD = 4 * 1_048_576

/** Gentle boost for recently *edited* files; mirrors the frecency buckets. */
function modifiedBoost(mtime: number, now: number, weight: number): number {
  if (weight <= 0 || !mtime) return 1
  const dt = now - mtime
  let r: number
  if (dt < HOUR) r = 1
  else if (dt < DAY) r = 0.6
  else if (dt < WEEK) r = 0.25
  else r = 0
  return 1 + weight * r
}

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i

export class SearchEngine {
  private ms: MiniSearch<IndexDoc>

  constructor(private plugin: LeanSearchPlugin) {
    this.ms = new MiniSearch<IndexDoc>(this.options())
  }

  /** Rebuild the empty index with current settings (tokenizer/diacritics). */
  recreate(): void {
    this.ms = new MiniSearch<IndexDoc>(this.options())
  }

  serialize(): string {
    return JSON.stringify(this.ms)
  }

  async loadSerialized(serialized: string): Promise<void> {
    this.ms =
      serialized.length >= ASYNC_LOAD_THRESHOLD
        ? await MiniSearch.loadJSONAsync<IndexDoc>(serialized, this.options())
        : MiniSearch.loadJSON<IndexDoc>(serialized, this.options())
  }

  private options(): Options<IndexDoc> {
    const s = this.plugin.settings
    return {
      idField: 'path',
      fields: ['basename', 'aliases', 'headings', 'tags', 'directory', 'body'],
      tokenize: makeIndexTokenizer(s.splitCompoundWords),
      processTerm: makeProcessTerm(s.ignoreDiacritics),
    }
  }

  has(path: string): boolean {
    return this.ms.has(path)
  }
  get size(): number {
    return this.ms.documentCount
  }

  addOrReplace(doc: IndexDoc): void {
    if (this.ms.has(doc.path)) this.ms.replace(doc)
    else this.ms.add(doc)
  }
  remove(path: string): void {
    if (this.ms.has(path)) this.ms.discard(path)
  }
  clear(): void {
    this.ms.removeAll()
  }

  private norm(str: string): string {
    const lower = (str ?? '').toLowerCase()
    return this.plugin.settings.ignoreDiacritics
      ? removeDiacritics(lower)
      : lower
  }

  /**
   * Rank candidates: MiniSearch relevance, then explicit title/heading
   * substring bonuses (so heading hits reliably win), then the frecency
   * multiplier (so recently/often opened notes float to the top).
   */
  private rank(query: Query): Ranked[] {
    const s = this.plugin.settings
    const raw: SearchResult[] = this.ms.search(query.searchString(), {
      prefix: true,
      fuzzy: term => (term.length > 4 ? s.fuzziness : 0),
      combineWith: 'AND',
      tokenize: makeSearchTokenizer(),
      processTerm: makeProcessTerm(s.ignoreDiacritics),
      boost: {
        basename: s.weightTitle,
        aliases: s.weightAliases,
        headings: s.weightHeadings,
        tags: s.weightTags,
        directory: s.weightDirectory,
        body: s.weightBody,
      },
    })

    const now = Date.now()
    const needles = [...query.text, ...query.phrases].map(t => this.norm(t))
    const wantTags = query.tags.map(t => this.norm(t))

    const out: Ranked[] = []
    for (const r of raw) {
      const meta = this.plugin.documentStore.get(r.id as string)
      if (!meta) continue

      // Required tags must be present (precise, like asking for exactly those).
      if (wantTags.length) {
        const have = meta.tags.map(t => this.norm(t))
        if (!wantTags.every(w => have.some(h => h === w || h.includes(w)))) {
          continue
        }
      }

      // Field bonuses — kept as one combined multiplier so the breakdown is
      // exact: score = base × fieldBonus × frecencyMult × modifiedMult.
      const base = r.score
      let fieldBonus = 1
      if (needles.length) {
        const title = this.norm(`${meta.basename} ${meta.displayTitle}`)
        const containsAll = (hay: string) =>
          needles.every(n => hay.includes(n))

        // Exact title match — almost certainly the target.
        if (this.norm(meta.basename) === needles.join(' ')) fieldBonus *= 6
        else if (containsAll(title)) fieldBonus *= 3

        // A single heading containing all terms (fixes "misses headings").
        if (meta.headings.some(h => containsAll(this.norm(h)))) fieldBonus *= 2.5

        if (meta.aliases.some(a => containsAll(this.norm(a)))) fieldBonus *= 2
      }

      // zoxide-style open-recency multiplier, plus an edit-recency multiplier.
      const f = this.plugin.frecency.score(r.id as string, now)
      const frecencyMult = 1 + s.recencyWeight * Math.log1p(f)
      const modifiedMult = modifiedBoost(meta.mtime, now, s.modifiedRecencyWeight)
      const score = base * fieldBonus * frecencyMult * modifiedMult

      out.push({
        path: r.id as string,
        score,
        frecency: f,
        debug: s.debugScoring
          ? {
              base,
              fieldBonus,
              frecency: f,
              frecencyMult,
              modifiedMult,
              final: score,
              terms: r.terms ?? [],
            }
          : undefined,
      })
    }

    out.sort((a, b) => b.score - a.score)
    return out
  }

  /** Empty-query view: your most frecent notes, like `zoxide` with no arg. */
  private frecentRanked(limit: number): Ranked[] {
    const now = Date.now()
    const debug = this.plugin.settings.debugScoring
    return this.plugin.frecency
      .topPaths(limit, now)
      .filter(p => this.plugin.documentStore.has(p))
      .map(p => {
        const f = this.plugin.frecency.score(p, now)
        return {
          path: p,
          score: f,
          frecency: f,
          debug: debug
            ? {
                base: 0,
                fieldBonus: 1,
                frecency: f,
                frecencyMult: f,
                modifiedMult: 1,
                final: f,
                terms: [],
              }
            : undefined,
        }
      })
  }

  /** Resolve a frontmatter/markdown image reference to a displayable src. */
  private resolveImageSrc(
    raw: string,
    sourcePath: string
  ): string | undefined {
    let ref = (raw ?? '').trim()
    if (!ref) return undefined
    if (/^https?:\/\//i.test(ref)) return ref
    // Strip wikilink/embed wrappers and any |size suffix.
    ref = ref
      .replace(/^!?\[\[/, '')
      .replace(/\]\]$/, '')
      .split('|')[0]!
      .trim()
    if (!ref) return undefined
    const dest =
      this.plugin.app.metadataCache.getFirstLinkpathDest(ref, sourcePath) ??
      this.plugin.app.vault.getAbstractFileByPath(ref)
    if (dest instanceof TFile && IMAGE_EXT.test(dest.path)) {
      return this.plugin.app.vault.getResourcePath(dest)
    }
    return undefined
  }

  /** First image for a note: frontmatter cover, else first inline embed. */
  private findImage(meta: DocMeta, content: string): string | undefined {
    if (meta.image) {
      const src = this.resolveImageSrc(meta.image, meta.path)
      if (src) return src
    }
    if (content) {
      // Obsidian embed: ![[image.png]]
      const embed = content.match(/!\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\]/)
      if (embed?.[1] && IMAGE_EXT.test(embed[1])) {
        const src = this.resolveImageSrc(embed[1], meta.path)
        if (src) return src
      }
      // Markdown image: ![alt](path-or-url)
      const md = content.match(/!\[[^\]]*\]\(\s*<?([^)>\s]+)>?[^)]*\)/)
      if (md?.[1]) {
        const ref = decodeURI(md[1])
        if (IMAGE_EXT.test(ref) || /^https?:\/\//i.test(ref)) {
          const src = this.resolveImageSrc(ref, meta.path)
          if (src) return src
        }
      }
    }
    return undefined
  }

  /**
   * Top results as displayable notes. Content is read lazily here for the
   * displayed set only — used for excerpts, highlighting, and exact
   * phrase / exclusion filtering.
   */
  async getSuggestions(
    query: Query,
    onPartial?: (notes: ResultNote[]) => void
  ): Promise<ResultNote[]> {
    const s = this.plugin.settings
    const isEmpty = query.isEmpty()
    let ranked: Ranked[]

    if (isEmpty) {
      if (!s.showFrecentOnEmpty) return []
      ranked = this.frecentRanked(s.maxResults)
    } else {
      ranked = this.rank(query)
    }

    const needPhraseOrExclude =
      query.phrases.length > 0 || query.exclude.length > 0
    const window = needPhraseOrExclude ? s.maxResults * 2 : s.maxResults
    const candidates = ranked.slice(0, window)

    const phrasesN = query.phrases.map(p => this.norm(p))
    const excludeN = query.exclude.map(e => this.norm(e))
    const words = query.foundWords()

    const notes: ResultNote[] = []
    let sentPartial = false
    if (!needPhraseOrExclude) {
      const initial: ResultNote[] = []
      for (const c of candidates.slice(0, CONTENT_READ_CONCURRENCY)) {
        const meta = this.plugin.documentStore.get(c.path)
        if (!meta) continue
        initial.push({
          path: meta.path,
          basename: meta.basename,
          displayTitle: meta.displayTitle,
          score: c.score,
          frecency: c.frecency,
          mtime: meta.mtime,
          content: '',
          foundWords: words,
          matches: [],
          debug: c.debug,
        })
      }
      if (initial.length) {
        sentPartial = true
        onPartial?.(initial)
      }
    }

    candidateBatches: for (
      let i = 0;
      i < candidates.length;
      i += CONTENT_READ_CONCURRENCY
    ) {
      const batch = await Promise.all(
        candidates.slice(i, i + CONTENT_READ_CONCURRENCY).map(async c => {
          const meta = this.plugin.documentStore.get(c.path)
          if (!meta) return undefined
          // Recents skip content reads so the empty-query view remains instant.
          const content = isEmpty
            ? ''
            : await this.plugin.documentStore.readContent(c.path)
          return { c, meta, content }
        })
      )

      for (const candidate of batch) {
        if (!candidate) continue
        const { c, meta, content } = candidate

        if (phrasesN.length || excludeN.length) {
          const hay = this.norm(
            `${meta.basename} ${meta.displayTitle} ${meta.headings.join(
              ' '
            )} ${meta.aliases.join(' ')} ${content}`
          )
          if (phrasesN.length && !phrasesN.every(p => hay.includes(p))) continue
          if (excludeN.length && excludeN.some(e => hay.includes(e))) continue
        }

        const matches = words.length
          ? this.plugin.textProcessor.getMatches(content, words)
          : []

        // Image preview reuses the content already in hand (no extra read); for
        // recents only a frontmatter cover is available, keeping them instant.
        const imageSrc = s.showImagePreview
          ? this.findImage(meta, content)
          : undefined

        notes.push({
          path: meta.path,
          basename: meta.basename,
          displayTitle: meta.displayTitle,
          score: c.score,
          frecency: c.frecency,
          mtime: meta.mtime,
          content,
          foundWords: words,
          matches,
          imageSrc,
          debug: c.debug,
        })
        if (notes.length >= s.maxResults) break candidateBatches
      }
      if (!sentPartial && notes.length) {
        sentPartial = true
        onPartial?.([...notes])
      }
    }

    logVerbose(`"${query.raw}" → ${notes.length} results`)
    return notes
  }
}
