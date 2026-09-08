import { excerptAfter, excerptBefore, type SearchMatch } from './globals'
import { escapeHTML, escapeRegExp, removeDiacritics } from './utils'
import type LeanSearchPlugin from './main'

export class TextProcessor {
  constructor(private plugin: LeanSearchPlugin) {}

  private normalize(s: string): string {
    return this.plugin.settings.ignoreDiacritics ? removeDiacritics(s) : s
  }

  /** Build a case-insensitive regex matching any of the given words. */
  private stringsToRegex(strings: string[]): RegExp {
    const cleaned = [...new Set(strings.filter(Boolean))].sort(
      (a, b) => b.length - a.length
    )
    if (!cleaned.length) return /$^/
    const joined = cleaned
      .map(s => escapeRegExp(this.normalize(s)))
      .join('|')
    return new RegExp(`(${joined})`, 'giu')
  }

  /**
   * Find where the matched words occur in `text`. Offsets index into the
   * ORIGINAL text so the editor can jump there exactly.
   */
  getMatches(text: string, words: string[]): SearchMatch[] {
    const reg = this.stringsToRegex(words)
    const haystack = this.normalize(text)
    const matches: SearchMatch[] = []
    let m: RegExpExecArray | null
    let count = 0
    const start = Date.now()
    while ((m = reg.exec(haystack)) !== null) {
      if (++count > 100 || Date.now() - start > 50) break
      if (m.index < 0) continue
      const original = text.substring(m.index, m.index + m[0].length).trim()
      if (original) matches.push({ match: original, offset: m.index })
      if (m.index === reg.lastIndex) reg.lastIndex++ // avoid zero-width loop
    }
    return matches
  }

  /** Wrap matched substrings in a highlight span. */
  highlightText(text: string, matches: SearchMatch[]): string {
    if (!matches.length) return escapeHTML(text)
    const cls = `lean-search-highlight${
      this.plugin.settings.highlight ? ' lean-search-highlight--on' : ''
    }`
    const words = [...new Set(matches.map(m => m.match).filter(Boolean))]
    // Escape first, then highlight the matched original text.
    try {
      return escapeHTML(text).replace(
        new RegExp(
          `(${words.map(w => escapeRegExp(escapeHTML(w))).join('|')})`,
          'giu'
        ),
        `<span class="${cls}">$1</span>`
      )
    } catch {
      return escapeHTML(text)
    }
  }

  /** A short snippet of `content` centered on `offset`. */
  makeExcerpt(content: string, offset: number): string {
    try {
      const pos = offset ?? -1
      let from = 0
      let to = Math.min(content.length, excerptAfter)
      if (pos > -1) {
        from = Math.max(0, pos - excerptBefore)
        to = Math.min(content.length, pos + excerptAfter)
      }
      let slice = content.slice(from, to)
      // Collapse whitespace/newlines for a tidy one-liner-ish excerpt.
      slice = slice.replace(/\s+/g, ' ').trim()
      const prefix = from > 0 ? '…' : ''
      const suffix = to < content.length ? '…' : ''
      return prefix + slice + suffix
    } catch {
      return ''
    }
  }
}
