import type LeanSearchPlugin from './main'

const MAX = 20

/** Recent queries, kept in memory and persisted with plugin data. */
export class SearchHistory {
  private items: string[] = []
  private nextQueryIsEmpty = false

  constructor(private plugin: LeanSearchPlugin) {}

  load(items: string[] | undefined | null): void {
    this.items = Array.isArray(items) ? items.slice(0, MAX) : []
  }

  toJSON(): string[] {
    return this.items
  }

  add(query: string): void {
    if (!query) {
      this.nextQueryIsEmpty = true
      return
    }
    this.nextQueryIsEmpty = false
    this.items = [query, ...this.items.filter(q => q !== query)].slice(0, MAX)
    this.plugin.persist()
  }

  /** Most recent first; a leading '' means "start empty next time". */
  get(): string[] {
    return this.nextQueryIsEmpty ? ['', ...this.items] : [...this.items]
  }
}
