/**
 * Frecency store — the heart of Lean Search's "always find what you want".
 *
 * This is a direct port of zoxide's ranking model: every note carries an
 * open-count, and its effective score is that count scaled by how recently it
 * was last opened. Frequently + recently opened notes rise to the top; stale
 * ones fade. The data is tiny (count + timestamp per opened note) and is
 * persisted with the plugin's settings — no database, no index blob.
 *
 * https://github.com/ajeetdsouza/zoxide#aging
 */

const HOUR = 3600_000
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** zoxide aging: once total interactions pass this, decay all counts. */
const AGING_THRESHOLD = 9000
const AGING_FACTOR = 0.9
/** Drop entries whose count falls below this after aging. */
const MIN_COUNT = 1

type Entry = { count: number; last: number }

export class Frecency {
  private entries = new Map<string, Entry>()
  /** Called when the store mutates so the host can persist (debounced). */
  onChange: () => void = () => {}

  /** Record that a note was just opened. */
  record(path: string, now = Date.now()): void {
    const e = this.entries.get(path)
    if (e) {
      e.count += 1
      e.last = now
    } else {
      this.entries.set(path, { count: 1, last: now })
    }
    this.maybeAge()
    this.onChange()
  }

  /**
   * zoxide frecency: count scaled by a recency bucket.
   * Returns 0 for notes that were never opened.
   */
  score(path: string, now = Date.now()): number {
    const e = this.entries.get(path)
    if (!e) return 0
    const dt = now - e.last
    if (dt < HOUR) return e.count * 4
    if (dt < DAY) return e.count * 2
    if (dt < WEEK) return e.count * 0.5
    return e.count * 0.25
  }

  /** Paths with any frecency, best first. Used for the empty-query view. */
  topPaths(limit: number, now = Date.now()): string[] {
    return [...this.entries.keys()]
      .map(p => ({ p, s: this.score(p, now) }))
      .filter(o => o.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(o => o.p)
  }

  has(path: string): boolean {
    return this.entries.has(path)
  }

  remove(path: string): void {
    if (this.entries.delete(path)) this.onChange()
  }

  rename(oldPath: string, newPath: string): void {
    const e = this.entries.get(oldPath)
    if (!e) return
    this.entries.delete(oldPath)
    this.entries.set(newPath, e)
    this.onChange()
  }

  clear(): void {
    this.entries.clear()
    this.onChange()
  }

  private maybeAge(): void {
    let total = 0
    for (const e of this.entries.values()) total += e.count
    if (total <= AGING_THRESHOLD) return
    for (const [path, e] of this.entries) {
      e.count *= AGING_FACTOR
      if (e.count < MIN_COUNT) this.entries.delete(path)
    }
  }

  toJSON(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {}
    for (const [path, e] of this.entries) out[path] = [e.count, e.last]
    return out
  }

  loadJSON(data: Record<string, [number, number]> | undefined | null): void {
    this.entries.clear()
    if (!data) return
    for (const [path, [count, last]] of Object.entries(data)) {
      if (typeof count === 'number' && typeof last === 'number') {
        this.entries.set(path, { count, last })
      }
    }
  }
}
