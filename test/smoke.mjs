// Smoke test for the dependency-free core logic (frecency + query parsing).
// Bundled from the real TS source by esbuild, then run in Node.
import assert from 'node:assert'
import { Frecency } from '../src/search/frecency.ts'
import { Query } from '../src/search/query.ts'

let pass = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  pass++
  console.log('  ok  -', name)
}

console.log('Frecency (zoxide model):')
{
  const f = new Frecency()
  const now = 1_000_000_000_000

  // Never-opened note scores 0.
  ok('unopened note scores 0', f.score('a.md', now) === 0)

  // Recently opened (this instant) -> count(1) * 4.
  f.record('a.md', now)
  ok('just-opened note scores count*4', f.score('a.md', now) === 4)

  // Opening again increases the count -> more frecency.
  f.record('a.md', now)
  ok('reopening raises score (2*4=8)', f.score('a.md', now) === 8)

  // Recency buckets decay the score over time.
  const HOUR = 3600_000,
    DAY = 24 * HOUR,
    WEEK = 7 * DAY
  ok('within a day bucket -> count*2', f.score('a.md', now + 2 * HOUR) === 4)
  ok('within a week bucket -> count*0.5', f.score('a.md', now + 2 * DAY) === 1)
  ok('older than a week -> count*0.25', f.score('a.md', now + 2 * WEEK) === 0.5)

  // A recently + frequently opened note beats an old one (the whole point).
  f.record('recent.md', now)
  f.record('recent.md', now)
  // 'old.md' opened many times but long ago:
  for (let i = 0; i < 10; i++) f.record('old.md', now - 3 * WEEK)
  const sRecent = f.score('recent.md', now)
  const sOld = f.score('old.md', now)
  ok(`recent (${sRecent}) beats stale-but-frequent (${sOld})`, sRecent > sOld)

  // topPaths returns best-first and drops the low-scoring stale note.
  const top = f.topPaths(2, now)
  ok(
    'topPaths is sorted best-first',
    f.score(top[0], now) >= f.score(top[1], now)
  )
  ok('topPaths drops the stale note (limit 2)', !top.includes('old.md'))

  // rename + remove + persistence round-trip.
  f.rename('recent.md', 'renamed.md')
  ok('rename moves frecency', f.score('renamed.md', now) === 8 && !f.has('recent.md'))
  f.remove('renamed.md')
  ok('remove deletes frecency', !f.has('renamed.md'))

  const f2 = new Frecency()
  f2.loadJSON(f.toJSON())
  ok('persistence round-trips', f2.score('old.md', now) === f.score('old.md', now))
}

console.log('\nQuery parsing:')
{
  const q1 = new Query('foo bar')
  ok('plain terms', q1.text.join(',') === 'foo,bar' && q1.searchString() === 'foo bar')
  ok('not empty', !q1.isEmpty())

  const q2 = new Query('"exact phrase" loose')
  ok('phrase extracted', q2.phrases.join('|') === 'exact phrase')
  ok('phrase removed from text', q2.text.join(',') === 'loose')

  const q3 = new Query('#project note -draft')
  ok('tag parsed without #', q3.tags.join(',') === 'project')
  ok('exclusion parsed without -', q3.exclude.join(',') === 'draft')
  ok('remaining text', q3.text.join(',') === 'note')

  const q4 = new Query('   ')
  ok('whitespace-only is empty', q4.isEmpty())

  const q5 = new Query('"a b" c #t')
  ok(
    'searchString includes text+tags+phrases',
    q5.searchString() === 'c t a b'
  )
  ok('foundWords includes phrase subwords', q5.foundWords().includes('a') && q5.foundWords().includes('b'))
}

console.log(`\n${pass} assertions passed.`)
