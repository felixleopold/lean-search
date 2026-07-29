import assert from 'node:assert'
import { IndexCache } from '../src/index-cache.ts'

const files = new Map()
const adapter = {
  async exists(path) {
    return files.has(path)
  },
  async read(path) {
    return files.get(path)
  },
  async write(path, value) {
    files.set(path, value)
  },
  async remove(path) {
    files.delete(path)
  },
  async rename(from, to) {
    files.set(to, files.get(from))
    files.delete(from)
  },
}

const settings = {
  indexBody: true,
  ignoreDiacritics: true,
  splitCompoundWords: true,
  extraExtensions: [],
}
const meta = {
  path: 'note.md',
  basename: 'note',
  displayTitle: '',
  aliases: [],
  tags: [],
  headings: [],
  mtime: 123,
  image: '',
}

function makePlugin() {
  let size = 1
  let restoredIndex = ''
  let restoredMetas = []
  let recreated = false
  let cleared = false
  return {
    manifest: { dir: '.obsidian/plugins/lean-search' },
    settings,
    app: { vault: { adapter } },
    searchEngine: {
      get size() {
        return size
      },
      serialize: () => '{"index":"serialized"}',
      loadSerialized(value) {
        restoredIndex = value
        size = 1
      },
      recreate() {
        recreated = true
        size = 0
      },
    },
    documentStore: {
      toJSON: () => [meta],
      loadJSON(value) {
        restoredMetas = value
      },
      clear() {
        cleared = true
      },
    },
    state: () => ({
      restoredIndex,
      restoredMetas,
      recreated,
      cleared,
    }),
  }
}

const writerPlugin = makePlugin()
const writer = new IndexCache(writerPlugin)
writer.scheduleSave()
writer.stop()
await writer.saveNow()

const cachePath =
  '.obsidian/plugins/lean-search/search-index-cache.json'
assert.ok(files.has(cachePath), 'cache is persisted in the plugin directory')
assert.ok(
  !files.has('.obsidian/plugins/lean-search/search-index-cache.tmp'),
  'temporary cache is atomically replaced'
)

const readerPlugin = makePlugin()
const restored = await new IndexCache(readerPlugin).restore()
assert.equal(restored, true, 'valid cache restores')
assert.equal(
  readerPlugin.state().restoredIndex,
  '{"index":"serialized"}',
  'serialized MiniSearch index restores'
)
assert.deepEqual(
  readerPlugin.state().restoredMetas,
  [meta],
  'cached document metadata restores'
)

files.set(cachePath, '{bad json}\n{}')
const corruptPlugin = makePlugin()
const corruptRestored = await new IndexCache(corruptPlugin).restore()
assert.equal(corruptRestored, false, 'corrupt cache falls back')
assert.equal(corruptPlugin.state().recreated, true, 'index is reset after corruption')
assert.equal(corruptPlugin.state().cleared, true, 'metadata is reset after corruption')

console.log('  ok  - persistent index cache round-trip and corruption fallback')
