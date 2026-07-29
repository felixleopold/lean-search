import {
  SPACE_OR_PUNCTUATION,
  isCJK,
  removeDiacritics,
  splitCamelCase,
  splitHyphens,
} from '../utils'

export type Tokenizer = (text: string) => string[]
export type TermProcessor = (term: string) => string

/** Normalize a single term: lowercase and (optionally) strip diacritics. */
export function makeProcessTerm(ignoreDiacritics: boolean): TermProcessor {
  return (term: string) => {
    const t = term.toLowerCase()
    return ignoreDiacritics ? removeDiacritics(t) : t
  }
}

/** Emit CJK unigrams + bigrams so CJK text is searchable without a segmenter. */
function cjkGrams(token: string): string[] {
  const chars = [...token].filter(isCJK)
  if (chars.length < 2) return chars
  const out: string[] = [...chars]
  for (let i = 0; i < chars.length - 1; i++) {
    out.push(chars[i]! + chars[i + 1]!)
  }
  return out
}

function hasCJK(token: string): boolean {
  return [...token].some(isCJK)
}

/**
 * Tokenizer for indexing. Produces extra tokens (compound splits, CJK grams)
 * so a note is findable several ways. More tokens here = more recall.
 */
export function makeIndexTokenizer(splitCompound: boolean): Tokenizer {
  return (text: string) => {
    const out: string[] = []
    for (const token of text.split(SPACE_OR_PUNCTUATION)) {
      if (!token) continue
      out.push(token)
      if (splitCompound) {
        out.push(...splitCamelCase(token), ...splitHyphens(token))
      }
      if (hasCJK(token)) out.push(...cjkGrams(token))
    }
    return out.filter(Boolean)
  }
}

/**
 * Tokenizer for the query. Plain split (no compound expansion) so that
 * AND-combining the terms stays precise — we want exactly what was typed.
 */
export function makeSearchTokenizer(): Tokenizer {
  return (text: string) => {
    const out: string[] = []
    for (const token of text.split(SPACE_OR_PUNCTUATION)) {
      if (!token) continue
      out.push(token)
      if (hasCJK(token)) out.push(...cjkGrams(token))
    }
    return out.filter(Boolean)
  }
}
