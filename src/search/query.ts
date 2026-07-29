/**
 * A small, predictable query language:
 *   foo bar      → both terms must match (AND)
 *   "foo bar"    → exact phrase must appear
 *   #project     → must be tagged #project
 *   -draft       → must NOT contain "draft"
 */
export class Query {
  readonly raw: string
  readonly text: string[] = []
  readonly tags: string[] = [] // without the leading '#'
  readonly phrases: string[] = []
  readonly exclude: string[] = []

  constructor(raw = '') {
    this.raw = raw.trim()
    let rest = this.raw

    // Pull out quoted phrases first.
    rest = rest.replace(/"([^"]+)"/g, (_m, phrase: string) => {
      const p = phrase.trim()
      if (p) this.phrases.push(p)
      return ' '
    })

    for (const tokenRaw of rest.split(/\s+/)) {
      const token = tokenRaw.trim()
      if (!token) continue
      if (token.startsWith('#') && token.length > 1) {
        this.tags.push(token.slice(1))
      } else if (token.startsWith('-') && token.length > 1) {
        this.exclude.push(token.slice(1))
      } else {
        this.text.push(token)
      }
    }
  }

  isEmpty(): boolean {
    return (
      !this.text.length &&
      !this.tags.length &&
      !this.phrases.length &&
      !this.exclude.length
    )
  }

  /** The string handed to MiniSearch (positive terms only). */
  searchString(): string {
    return [...this.text, ...this.tags, ...this.phrases].join(' ')
  }

  /** Words to highlight in results. */
  foundWords(): string[] {
    return [
      ...this.text,
      ...this.tags,
      ...this.phrases,
      // phrase sub-words too, so each highlights
      ...this.phrases.flatMap(p => p.split(/\s+/)),
    ].filter(Boolean)
  }
}
