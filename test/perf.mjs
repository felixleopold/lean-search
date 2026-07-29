import assert from 'node:assert'
import { performance } from 'node:perf_hooks'
import { SearchEngine } from '../src/search/search-engine.ts'
import { Query } from '../src/search/query.ts'
import { TextProcessor } from '../src/text.ts'

const DOCUMENT_COUNT = 5_000
const RESULT_COUNT = 48
const READ_DELAY_MS = 4

const settings = {
  indexBody: true,
  fuzziness: 0,
  ignoreDiacritics: true,
  splitCompoundWords: true,
  recencyWeight: 1.5,
  modifiedRecencyWeight: 0.5,
  showFrecentOnEmpty: true,
  weightTitle: 12,
  weightHeadings: 8,
  weightTags: 6,
  weightAliases: 6,
  weightDirectory: 2,
  weightBody: 1,
  maxResults: RESULT_COUNT,
  showExcerpt: true,
  showImagePreview: false,
  highlight: true,
  openInNewPane: false,
  vimLikeNavigation: false,
  ribbonIcon: true,
  showPreviousQueryResults: true,
  debugScoring: false,
  extraExtensions: [],
  verboseLogging: false,
}

function makeHarness() {
  const metas = new Map()
  const bodies = new Map()
  let readDelay = 0
  const plugin = {
    settings,
    documentStore: {
      get: path => metas.get(path),
      has: path => metas.has(path),
      async readContent(path) {
        if (readDelay) {
          await new Promise(resolve => setTimeout(resolve, readDelay))
        }
        return bodies.get(path) ?? ''
      },
    },
    frecency: {
      score: () => 0,
      topPaths: () => [],
    },
    app: {
      metadataCache: {
        getFirstLinkpathDest: () => null,
      },
      vault: {
        getAbstractFileByPath: () => null,
      },
    },
  }
  plugin.textProcessor = new TextProcessor(plugin)
  plugin.searchEngine = new SearchEngine(plugin)
  return {
    plugin,
    metas,
    bodies,
    setReadDelay(value) {
      readDelay = value
    },
  }
}

const harness = makeHarness()
const buildStarted = performance.now()
for (let i = 0; i < DOCUMENT_COUNT; i++) {
  const path = `folder/note-${i}.md`
  const meta = {
    path,
    basename: `note-${i}`,
    displayTitle: `Needle reference ${i}`,
    aliases: [],
    tags: ['benchmark'],
    headings: ['Synthetic benchmark'],
    mtime: 1_700_000_000_000 + i,
    image: '',
  }
  const body =
    `This synthetic note contains needle ${i}. ` +
    'Additional representative body text for search indexing. '.repeat(8)
  harness.metas.set(path, meta)
  harness.bodies.set(path, body)
  harness.plugin.searchEngine.addOrReplace({
    path,
    basename: `${meta.basename} ${meta.displayTitle}`,
    aliases: '',
    headings: meta.headings[0],
    tags: 'benchmark',
    directory: 'folder',
    body,
  })
}
const buildMs = performance.now() - buildStarted

const serializedStarted = performance.now()
const serialized = harness.plugin.searchEngine.serialize()
const serializeMs = performance.now() - serializedStarted

const restored = makeHarness()
for (const [path, meta] of harness.metas) restored.metas.set(path, meta)
for (const [path, body] of harness.bodies) restored.bodies.set(path, body)
const restoreStarted = performance.now()
await restored.plugin.searchEngine.loadSerialized(serialized)
const restoreMs = performance.now() - restoreStarted

const query = new Query('needle')
const median = values =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

const warmSamples = []
let warmResults = []
for (let i = 0; i < 5; i++) {
  const started = performance.now()
  warmResults = await restored.plugin.searchEngine.getSuggestions(query)
  warmSamples.push(performance.now() - started)
}
const warmMs = median(warmSamples)

restored.setReadDelay(READ_DELAY_MS)
const partialSamples = []
const concurrentSamples = []
for (let i = 0; i < 5; i++) {
  let partialMs = 0
  let partialCount = 0
  const started = performance.now()
  const results = await restored.plugin.searchEngine.getSuggestions(
    query,
    partial => {
      partialMs = performance.now() - started
      partialCount = partial.length
    }
  )
  partialSamples.push(partialMs)
  concurrentSamples.push(performance.now() - started)
  assert.equal(results.length, RESULT_COUNT)
  assert.equal(partialCount, 8)
  assert.deepEqual(
    results.map(result => result.path),
    warmResults.map(result => result.path)
  )
}
const partialMs = median(partialSamples)
const concurrentMs = median(concurrentSamples)

assert.equal(restored.plugin.searchEngine.size, DOCUMENT_COUNT)

const serialHydrationEstimate = warmMs + RESULT_COUNT * READ_DELAY_MS
const inputSpeedup = 250 / 60

console.log(`Synthetic vault:       ${DOCUMENT_COUNT.toLocaleString()} notes`)
console.log(`Fresh index build:     ${buildMs.toFixed(1)} ms`)
console.log(
  `Serialized index:      ${(serialized.length / 1_048_576).toFixed(1)} MB in ${serializeMs.toFixed(1)} ms`
)
console.log(`Restart restore:       ${restoreMs.toFixed(1)} ms`)
console.log(`Warm query (median):   ${warmMs.toFixed(1)} ms`)
console.log(`First 8 (median):      ${partialMs.toFixed(1)} ms`)
console.log(`Hydration (median):    ${concurrentMs.toFixed(1)} ms`)
console.log(`Serial estimate:       ${serialHydrationEstimate.toFixed(1)} ms`)
console.log(
  `Input dispatch:        60 ms vs 250 ms (${inputSpeedup.toFixed(1)}x sooner)`
)
