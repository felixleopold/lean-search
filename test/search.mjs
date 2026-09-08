import assert from 'node:assert/strict'
import { SearchEngine } from '../src/search/search-engine.ts'
import { makeIndexTokenizer } from '../src/search/tokenizer.ts'
import { Query } from '../src/search/query.ts'

const metas = new Map()
let reads = 0
let matches = 0
let releaseReads
let readGate = Promise.resolve()
const plugin = {
  settings: {
    maxResults: 24, ignoreDiacritics: true, splitCompoundWords: true,
    fuzziness: 0, recencyWeight: 1, modifiedRecencyWeight: 0,
  },
  documentStore: {
    get: path => metas.get(path),
    async readContent() {
      reads++
      await readGate
      return 'needle content'
    },
  },
  frecency: { score: () => 0 },
  textProcessor: { getMatches: () => { matches++; return [] } },
}
const engine = new SearchEngine(plugin)
for (let i = 0; i < 24; i++) {
  const path = `${i}.md`
  metas.set(path, {
    path, basename: 'needle', displayTitle: '', tags: [],
    headings: [], aliases: [], mtime: 0,
  })
  engine.addOrReplace({ path, basename: 'needle' })
}
const query = new Query('needle')
const expected = await engine.getSuggestions(query)
assert.equal(expected.length, 24)
assert.equal(reads, 24)

reads = 0
matches = 0
readGate = new Promise(resolve => { releaseReads = resolve })
const controller = new AbortController()
let partialCount = 0
const pending = engine.getSuggestions(query, () => { partialCount++ }, controller.signal)
assert.equal(reads, 8, 'only one read batch starts at a time')
controller.abort()
releaseReads()
assert.deepEqual(await pending, [])
assert.equal(reads, 8, 'obsolete searches never start another batch')
assert.equal(matches, 0, 'obsolete content is not processed')
assert.equal(partialCount, 1)
assert.deepEqual(await engine.getSuggestions(query, undefined, controller.signal), [])
assert.equal(reads, 8, 'already cancelled searches do no reads')

readGate = Promise.resolve()
assert.deepEqual(await engine.getSuggestions(query), expected, 'later searches retain results and ranking')
assert.deepEqual(
  makeIndexTokenizer(true)('helloWorld 日本語 abc日本 😀'),
  ['helloWorld', 'hello', 'World', '日本語', '日', '本', '語', '日本', '本語',
    'abc日本', '日', '本', '日本', '😀'],
)
console.log('  ok  - search cancellation, result parity, and mixed-language tokenization')
