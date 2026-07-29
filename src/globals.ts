import { writable } from 'svelte/store'

export const excerptBefore = 100
export const excerptAfter = 300

/** Keyboard actions emitted through the event bus from the modal scope. */
export const enum Action {
  Enter = 'enter',
  OpenInNewPane = 'open-in-new-pane',
  OpenInNewLeaf = 'open-in-new-leaf',
  OpenInBackground = 'open-in-background',
  InsertLink = 'insert-link',
  CreateNote = 'create-note',
  Tab = 'tab',
  ArrowUp = 'arrow-up',
  ArrowDown = 'arrow-down',
  PrevSearchHistory = 'prev-search-history',
  NextSearchHistory = 'next-search-history',
}

export const enum IndexingStep {
  Idle,
  LoadingCache,
  RefreshingCache,
  ReadingMetadata,
  IndexingBody,
  Done,
}

/** Lightweight per-note metadata kept in memory (NO body text). */
export type DocMeta = {
  path: string
  basename: string
  displayTitle: string
  aliases: string[]
  tags: string[]
  headings: string[]
  mtime: number
  /** Raw frontmatter image/cover/banner value, if any (for image preview). */
  image: string
}

/** The document shape fed to MiniSearch. `body` is transient (never retained). */
export type IndexDoc = {
  path: string
  basename: string
  aliases: string
  headings: string
  tags: string
  directory: string
  body: string
}

export type SearchMatch = {
  match: string
  offset: number
}

/** Per-result score breakdown, populated only when debug scoring is on. */
export type ScoreDebug = {
  /** Raw MiniSearch relevance ("fuzzy") score. */
  base: number
  /** Combined title/heading/alias substring multiplier (1 = none). */
  fieldBonus: number
  /** zoxide frecency value (open-count × recency bucket). */
  frecency: number
  /** Multiplier from open-frecency (recency). */
  frecencyMult: number
  /** Multiplier from how recently the file was edited. */
  modifiedMult: number
  /** Final score after all multipliers. */
  final: number
  /** Query terms MiniSearch actually matched. */
  terms: string[]
}

export type ResultNote = {
  path: string
  basename: string
  displayTitle: string
  score: number
  /** zoxide-style frecency score for this note (0 if never opened). */
  frecency: number
  /** File modification time (ms), for the "recently edited" badge/boost. */
  mtime: number
  content: string
  foundWords: string[]
  matches: SearchMatch[]
  /** Resolved thumbnail src, when image preview is on and one was found. */
  imageSrc?: string
  /** Score breakdown, present only when debug scoring is enabled. */
  debug?: ScoreDebug
}

export const indexingStep = writable<IndexingStep>(IndexingStep.Idle)

let inComposition = false
export function toggleInputComposition(toggle: boolean): void {
  inComposition = toggle
}
export function isInputComposition(): boolean {
  return inComposition
}
